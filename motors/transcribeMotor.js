const revai = require("revai-node-sdk");


// // set webhook
// // Set up an optional webhook url to call on completion
// const notificationConfig = {
//     url: "https://example.com/callback"
// };

const transcribe = (token) => async (buffer) => {
	try {
		const client = new revai.RevAiApiClient(token);

		// Get account details
		const account = await client.getAccount();
		// console.log(`Account: ${account.email}`);
		console.log(`Credits remaining: ${account.balance_seconds} seconds`);
		console.log(`account.total_balance: ${account.total_balance}`);//account.total_balance
		
		// Media may be submitted from a local file
		let job = await client.submitJobAudioData(buffer);
		//let job = await client.submitJobLocalFile(pathAudio);
		
		console.log(`Job Id: ${job.id}`);
		console.log(`Status: ${job.status}`);
		console.log(`Created On: ${job.created_on}`);
		
		let jobDetails = (await client.getJobDetails(job.id))
		console.log(`Job ${job.id} is ${jobDetails.status}`);

		while (jobDetails.status === "in_progress") {
			jobDetails = await client.getJobDetails(job.id)
			console.log(`Job ${job.id} is ${jobDetails.status}`);
			await new Promise((resolve) => setTimeout(resolve, 3000));
		}

		if (jobDetails.status === "failed") {
			console.error(`failed to transcript. job status: ${jobDetails.id}`);
			throw new Error("failed to transcript")
		}
		
		let transcriptText = await client.getTranscriptText(jobDetails.id);
		// var transcriptTextStream = await client.getTranscriptTextStream(job.id);
		// var transcriptObject = await client.getTranscriptObject(job.id);
		// var transcriptObjectStream = await client.getTranscriptObjectStream(job.id);
		// var captionsStream = await client.getCaptions(job.id);

		console.log(`${job.id}.txt is saved`);

		return { jobID: job.id, transcriptText };
	} catch (err) {
		console.error(`transcribe: ${err}`);
		throw err;
	}
};

const init = (token) => {
	return {
		transcribe: transcribe(token),
	}
}

module.exports = init;
