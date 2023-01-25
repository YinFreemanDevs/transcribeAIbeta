const getMP3Duration = require("get-mp3-duration");
const stripe = require("stripe")(process.env.STRIPE);

const stripePaymentUrl = async ({
	stackOrders,
	expiration,
	buffer,
	fileName,
	fileUrl,
}) => {
	let duration = getMP3Duration(buffer);
	// console.log("duration: ", duration);

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

	let wait = waitMin * 1;
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
						name: fileName,
						description: `THE WAITING TIME IS ${wait} MINUTES. DO NOT CLOSE THIS WINDOW UNTIL THE DOWNLOAD IS READY.`,
					},
					unit_amount: price,
				},
				quantity: 1,
			},
		],
		metadata: { name: fileName },
		mode: "payment",
		client_reference_id: fileUrl,
		success_url: `http://localhost:3000/transcribe?url=${fileUrl}`,
		cancel_url: "http://localhost:3000",
	});

	stackOrders.push({
		name: fileName,
		duration: duration,
		uploaded: true,
		id: session.id,
		url: fileUrl,
		done: false,
		ended: false,
		expiration: expiration,
	});
	return session.url;
};
const redirectToStripe = async ({
	expressResponse,
	stackOrders,
	buffer,
	fileName,
	fileUrl,
	expiration,
}) => {

		const paymentUrl = await stripePaymentUrl({
			stackOrders,
			expiration,
			buffer,
			fileName,
			fileUrl,
		});
		return expressResponse.redirect(303, paymentUrl);
};
exports.redirectToStripe = redirectToStripe;

exports.getStripeSession = async (stripeSessionID) => {
	const sessions = await stripe.checkout.sessions.retrieve(stripeSessionID);
	return sessions;
};
