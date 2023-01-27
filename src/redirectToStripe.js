const getMP3Duration = require("get-mp3-duration");
const stripe = require("stripe")(process.env.STRIPE);

const CURRENCY = "eur";
const MAX_MINUTES = 15;
const stripePaymentUrl = async ({
	stackOrders,
	expiration,
	buffer,
	fileName,
	fileUrl,
}) => {
	let duration = getMP3Duration(buffer);
	// console.log("duration: ", duration);

	let minutes = duration / 60000;
	if (minutes < MAX_MINUTES) minutes = MAX_MINUTES;

	let min = Math.round(minutes);
	let waitingTime = ((min * 60) / 6) / 60;
	let waitMin = Math.round(waitingTime);
	if (waitMin < 1) waitMin = 1;

	let wait = waitMin * 1;
	if (wait === null) wait = 60;

	console.log("Wait", wait, "minutes...");
	let price = parseInt(min * 0.18 * 100);

	const session = await stripe.checkout.sessions.create({
		line_items: [
			{
				price_data: {
					currency: CURRENCY,
					product_data: {
						name: fileName,
						description: getWaitingDescription(wait),
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
		buffer: buffer,
		expiration: expiration,
	});
	return session.url;

};

const getWaitingDescription = (wait)=> {
	return `THE WAITING TIME IS ${wait} MINUTES. DO NOT CLOSE THIS WINDOW UNTIL THE DOWNLOAD IS READY.`;
}

exports.redirectToStripe = async ({
	expressResponse,
	stackOrders,
	buffer,
	fileName,
	fileUrl,
	expiration,
}) => {
	try {
		const paymentUrl = await stripePaymentUrl({
			stackOrders,
			expiration,
			buffer,
			fileName,
			fileUrl,
		});
		return expressResponse.redirect(303, paymentUrl);
	} catch (err) {
		console.error(`redirectToStripe: ${err}`);
		throw err;
	}
};

exports.getStripeSession = async (stripeSessionID) => {
	const sessions = await stripe.checkout.sessions.retrieve(stripeSessionID);
	return sessions;
};
