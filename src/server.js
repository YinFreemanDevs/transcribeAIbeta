const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const bodyParser = require("body-parser");
const path = require("path");

dotenv.config();

const PROTO_PATH = process.env.PROTO_PATH;
const GRPC_SERVER = process.env.GRPC_SERVER;
const DEBUG = process.env.DEBUG === "true";
const GRPC_TOKEN = process.env.GRPC_TOKEN;
const { transcribe } = require("../motors/transcribeMotor.js")(
	process.env.TOKEN,
);
const { redirectToStripe, getStripeSession } = require("./redirectToStripe");

const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
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
		this.metadata = new grpc.Metadata();
		this.metadata.add("Authorization", `Bearer ${GRPC_TOKEN}`);

		// Establish connection with the server
		this.grpcClient = new downloadProto.DownloadService(
			GRPC_SERVER,
			grpc.credentials.createInsecure(),
		);
		this.app = express();
		this.app.set("view engine", "ejs");

		this.app.set("views", "../views");

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
			this.grpcClient.Read({ id: url }, this.metadata, (err, video) => {
				if (!err) {
					if (video.transcription === "") {
						// TODO: throw error
					}
					res.set({
						"Content-Disposition": `attachment; filename="${video.file_name}.txt"`,
					});
					return res.send(video.transcription);
				}

				if (err.details !== "Cannot find video with the ID provided") {
					return expressRedirectError({ res, err });
				}
				console.log("****** donwload file ******");
				const expiration = Date.now() + 3600000;
				let downloadFileGrpcCall = this.grpcClient.DownloadFile(
					{
						url: url,
					},
					this.metadata,
				);
				let buffers = [];
				let fileName = "";
				downloadFileGrpcCall.on("data", function (response) {
					//console.log("on data", response);
					buffers.push(Buffer.from(response.data));
					if (fileName === "") {
						fileName = response.file_name;
					}
				});
				downloadFileGrpcCall.on("error", function (e) {
					return expressRedirectError({ res, err: e });
				});

				downloadFileGrpcCall.on("end", async function () {
					let buffer = Buffer.concat(buffers);

					return await redirectToStripe({
						expressResponse: res,
						buffer,
						stackOrders: server.stackOrders,
						fileName: fileName,
						fileUrl: url,
						expiration,
					});
				});
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

						if (DEBUG) {
							order.transcription = " test: is a mock";
						} else {
							const { transcriptText } = await transcribe(order.buffer);
							order.transcription = transcriptText;
						}

						// save content in our database.
						server.grpcClient.Save(
							{
								url,
								file_name: order.name,
								transcription: order.transcription,
								created_by: "TODO",
								timestamp: Date.now(),
								created_at: new Date(Date.now()).toLocaleString("en-GB", {
									timezone: "GMT+1",
								}),
							},
							server.metadata,
							(err) => {
								if (err) {
									console.error(`grpcClient.save().sendMessage ${err}`);
									return expressRedirectError({ res, err });
								}
								res.set({
									"Content-Disposition": `attachment; filename="${order.name}.txt"`,
								});
								return res.send(order.transcription);
							},
						);
					}
				}

				console.log("delete order from stack:", order.name);
				this.stackOrders.splice(
					this.stackOrders.findIndex((v) => v.id === session.id),
					1,
				);
			} catch (err) {
				console.log(JSON.stringify(err));
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

const expressRedirectError = ({ res, err }) => {
	console.error(`error Read().sendMessage: ${err}`);
	res.render("error", {
		message: "please contact administrator",
	});
};
module.exports = Server;
