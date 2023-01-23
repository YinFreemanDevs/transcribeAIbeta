const express = require("express");
const { transcribe } = require("../motors/transcribeMotor.js");
const cors = require("cors");
const fileUpload = require("express-fileupload");
const dotenv = require("dotenv");
const fs = require("fs");
const bodyParser = require("body-parser");
const getMP3Duration = require("get-mp3-duration");
const path = require("path");

const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const grpc_promise = require("grpc-promise");
dotenv.config();

const PROTO_PATH = process.env.PROTO_PATH;
const GRPC_SERVER = process.env.GRPC_SERVER;

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
	keepCase: true,
	longs: String,
	enums: String,
	defaults: true,
	oneofs: true,
});

const downloadProto = grpc.loadPackageDefinition(packageDefinition).download;

const stripe = require("stripe")(process.env.STRIPE);

let wait;
let date;
let expiration;
let dirname = path.join(__dirname, "../");

class Server {
	constructor() {
		// Establish connection with the server
		this.grpcClient = new downloadProto.DownloadService(
			GRPC_SERVER,
			grpc.credentials.createInsecure(),
		);
		grpc_promise.promisifyAll(this.grpcClient);

		this.app = express();
		this.port = process.env.PORT || 3000;
		this.server = require("http").createServer(this.app);

		this.token = process.env.TOKEN;
		this.pathAudio = "";

		this.sessionURL = "";
		this.nameTxt = "";
		this.nameMp3 = "";
		this.duration = 0;
		this.fail = false;
		this.wait = "";

		this.stackSessions = "";
		this.stackUploads = [
			{
				name: null,
				path: null,
				duration: 0,
				uploaded: false,
				done: false,
				ended: false,
				expiration: null,
			},
		];

		this.middlewares();
		this.routes();
	}

	middlewares() {
		this.app.use(cors());
		this.app.use(express.static(`${dirname}/public`));
		this.app.use(fileUpload());
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

		this.app.post("/test-download-file", async (req, res) => {
			const { url } = req.body;

			console.log("Request: start-downloading");

			this.grpcClient
				.downloadFile()
				.sendMessage({ url })
				.then(async (bufferArray) => {
					console.log("*********");
					const buffer = Buffer.concat(
						bufferArray.map((d) => Buffer.from(d.data.buffer)),
					);
					console.log("buffer: ", buffer);
					return await redirect({ req, res, buffer });
				})
				.catch((err) => console.error(err));
		});

		this.app.post("/uploadFile", async (req, res) => {
			oldUpload({ req, res });
		}); //END POST

		this.app.get("/transcribeFile", (req, res) => {
			res.sendFile(`${dirname}/public/transcribeFile.html`);
		});

		this.app.post("/gotranscribe", async (req, res) => {
			const sessions = await stripe.checkout.sessions.list({
				limit: 3,
			});
			this.stackSessions = sessions.data;

			let y = 0;
			let x = 1;

			for (y in this.stackSessions) {
				if (this.stackSessions[y].payment_status === "paid") {
					this.stackSessions[y].payment_status = null;
					for (x in this.stackUploads) {
						if (
							this.stackSessions[y].metadata.name ===
								this.stackUploads[x].name &&
							this.stackUploads[x].done === false &&
							this.stackUploads[x].uploaded === true
						) {
							this.stackUploads[x].done = true;
						}
					}
				}
			}

			x = 1;
			while (x < this.stackUploads.length) {
				if (this.stackUploads[x].ended === false) {
					if (this.stackUploads[x].done === true) {
						console.log(`transcribe ${x}:`, this.stackUploads[x].name);
						this.stackUploads[x].ended = true;
						const jobID = await transcribe(
							this.token,
							this.stackUploads[x].path,
						);
						res.download(`${dirname}./downloads/${jobID}.txt`);
					} else {
						x++;
					}
				} else {
					x++;
				}
			}
			x = 1;
			while (x < this.stackUploads.length) {
				if (this.stackUploads[x].ended === true) {
					console.log("delete audio/video:", this.stackUploads[x].name);
					fs.unlinkSync(this.stackUploads[x].path);
					this.stackUploads.splice(x, 1);
					break;
				} else {
					x++;
				}
			}
		}); //END POST GOTRANSCRIBE
	} //END ROUTES

	listen() {
		this.server.listen(this.port, () => {
			console.log("Server up on port ", this.port);
		});
	}
}

const uploadUrl = async ({ server, buffer }) => {
	let duration = getMP3Duration(buffer);
	console.log("duration: ", duration);

	server.stackUploads.push({
		name: server.nameMp3,
		path: server.pathAudio,
		duration: duration,
		uploaded: true,
		done: false,
		ended: false,
		expiration: expiration,
	});

	let waitMin;
	let price;
	let min;
	let waitingTime;
	let minutes;

	minutes = duration / 60000;
	if (minutes < 15) {
		minutes = 15;
	}
	min = Math.round(minutes);
	waitingTime = (min * 60) / 6;
	waitingTime = waitingTime / 60;
	waitMin = Math.round(waitingTime);
	if (waitMin < 1) {
		waitMin = 1;
	}

	wait = waitMin * 1;
	if (wait === null) {
		wait = 60;
	}
	console.log("Wait", wait, "minutes...");
	price = min * 0.18 * 100;
	price = parseInt(price);

	const session = await stripe.checkout.sessions.create({
		line_items: [
			{
				price_data: {
					currency: "eur",
					product_data: {
						name: server.nameMp3,
						description: `THE WAITING TIME IS ${wait} MINUTES. DO NOT CLOSE THIS WINDOW UNTIL THE DOWNLOAD IS READY.`,
					},
					unit_amount: price,
				},
				quantity: 1,
			},
		],
		metadata: { name: server.nameMp3 },
		mode: "payment",
		success_url: "http://localhost:3000/transcribeFILE",
		cancel_url: "http://localhost:3000",
	});
	return session.url;
};

const redirect = async ({ req, res, buffer }) => {
	const sessionUrl = await uploadUrl({ server: this, buffer });
	return res.redirect(303, sessionUrl);
};

const oldUpload = ({ req, res }) => {
	let re = /(?:\.([^.]+))?$/;

	let EDFile = req.files.file;

	this.nameMp3 = EDFile.name;
	let ext = re.exec(EDFile.name)[1];

	if (ext !== "mp3") {
		this.fail = true;
		return res.status(500).send({
			message:
				"Bad codecs in video or bad extension, try again or download with other method.",
		});
	} else {
		EDFile.mv(`./uploads/${EDFile.name}`, async (err) => {
			if (err) return res.status(500).send({ message: err });

			this.pathAudio = `${dirname}/uploads/${EDFile.name}`;

			date = Date.now();
			expiration = date + 3600000;

			const buffer = fs.readFileSync(this.pathAudio);

			const sessionUrl = await uploadUrl({ server: this, buffer });

			return res.redirect(303, sessionUrl);
		}); //END EDFILE
	} //END ELSE
};

module.exports = Server;
