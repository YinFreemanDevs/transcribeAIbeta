const express = require("express");
const { transcribe } = require("../motors/transcribeMotor.js");
const cors = require("cors");
const dotenv = require("dotenv");
const bodyParser = require("body-parser");
const path = require("path");

const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const grpc_promise = require("grpc-promise");
dotenv.config();
const { redirectToStripe, getStripeSession } = require("./redirectToStripe");

const PROTO_PATH = process.env.PROTO_PATH;
const GRPC_SERVER = process.env.GRPC_SERVER;
const DEBUG = process.env.DEBUG === "true";
const GRPC_TOKEN = process.env.GRPC_TOKEN;

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
	keepCase: true,
	longs: String,
	enums: String,
	defaults: true,
	oneofs: true,
});

const downloadProto = grpc.loadPackageDefinition(packageDefinition).download;

let dirname = path.join(__dirname, "../");

class Server {
	constructor() {
		const metadata = new grpc.Metadata();
		metadata.add("Authorization", `Bearer ${GRPC_TOKEN}`);

		// Establish connection with the server
		this.grpcClient = new downloadProto.DownloadService(
			GRPC_SERVER,
			grpc.credentials.createInsecure(),
		);
		grpc_promise.promisifyAll(this.grpcClient, {
			metadata: metadata,
			timeout: 1000000000,
		});

		this.app = express();
		this.app.set("view engine", "ejs");

		this.app.set("views", "./views");

		this.port = process.env.PORT || 3000;
		this.httpServer = require("http").createServer(this.app);

		this.fail = false;

		this.stackOrders = [];

		this.middlewares();
		this.routes();
	}

	middlewares() {
		this.app.use(cors());
		this.app.use(express.static(`${dirname}/public`));
		this.app.use(bodyParser.urlencoded({ extended: true }));
		this.app.use(bodyParser.json());
	}

	routes() {
		this.app.get("/", (req, res) => {
			try {
				res.render(`${dirname}/public/index.html`);
			} catch (err) {
				console.log(err);
				return res.status(500).send({ message: "Problems loading the page" });
			}
		});

		this.app.post("/download_from_url", async (req, res) => {
			const { url } = req.body;
			const server = this;

			console.log("Request: start-downloading");

			// If is already transcripted then retrieve from db
			this.grpcClient
				.Read()
				.sendMessage({ id: url })
				.then((video) => {
					if (video.transcription === "") {
						// TODO: throw error
					}
					res.set({
						"Content-Disposition": `attachment; filename="${video.file_name}.txt"`,
					});
					res.send(video.transcription);
				})
				.catch((err) => {
					if (err.details === "Cannot find video with the ID provided") {
						console.log("****** donwload file ******");
						const expiration = Date.now() + 3600000;
						this.grpcClient
							.DownloadFile()
							.sendMessage({ url })
							.then(async (bufferArray) => {
								const buffer = Buffer.concat(
									bufferArray.map((d) => Buffer.from(d.data.buffer)),
								);
								return await redirectToStripe({
									expressResponse: res,
									buffer,
									stackOrders: server.stackOrders,
									fileName: bufferArray[0].file_name,
									fileUrl: url,
									expiration,
								});
							})
							.catch((e) => {
								console.log(`error this.grpcClient.DownloadFile(): ${e}`);
							});
					} else {
						console.error(`error Read().sendMessage: ${err}`);
						res.render("error", {
							message: "please contact administrator",
						});
					}
				});
		});

		this.app.get("/transcribe", (req, res) => {
			const url = req.query.url;
			res.render("transcribe", {
				url,
			});
		});

		this.app.post("/transcribe", async (req, res) => {
			try {
				const url = req.query.url;
				const order = this.stackOrders.find((v) => v.url === url);
				if (!order?.id) throw new Error("could not find order in stack");
				

				console.log("order.id", order.id);
				const session = await getStripeSession(order.id);

				console.log("session", session);
				const server = this;
				if (session.payment_status === "paid") {
					session.payment_status = null;

					if (!order.done && order.uploaded) {
						order.done = true;
						console.log(`transcribe ${session.id}:`, order.name);
						order.ended = true;

						order.transcription = DEBUG
							? " test: is a mock"
							: ({ transcriptText } = await transcribe({
									token: server.revai_token,
									buffer: order.buffer,
							  }));

						// save content in our database.
						server.grpcClient
							.save()
							.sendMessage({
								url,
								file_name: order.name,
								transcription: order.transcription,
								created_by: "TODO",
								timestamp: Date.now(),
								created_at: new Date(Date.now()).toLocaleString("en-GB", {
									timezone: "GMT+1",
								}),
							})
							.then(() => {
								res.set({
									"Content-Disposition": `attachment; filename="${order.name}"`,
								});
								res.send(order.transcription);
							})
							.catch((err) => {
								console.error(`grpcClient.save().sendMessage ${err}`);
							});
					}
				}

				console.log("delete order from stack:", order.name);
				this.stackOrders.splice(
					this.stackOrders.findIndex((v) => v.id === session.id),
					1,
				);
			} catch (err) {
				console.error(`this.app.post("/transcribe"): ${err}`);
			}
		});
	}

	listen() {
		this.httpServer.listen(this.port, () => {
			console.log("Server up on port ", this.port);
		});
	}
}

module.exports = Server;
