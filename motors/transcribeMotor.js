const revai = require("revai-node-sdk");
const fs = require("fs");

const transcribe = async (token, pathAudio) => {
	const client = new revai.RevAiApiClient(token);

	// Get account details
	const account = await client.getAccount();
	console.log(`Account: ${account.email}`);
	console.log(`Credits remaining: ${account.balance_seconds} seconds`);
	console.log(account);

	// Media may be submitted from a local file
	let job = await client.submitJobLocalFile(pathAudio);

	console.log(`Job Id: ${job.id}`);
	console.log(`Status: ${job.status}`);
	console.log(`Created On: ${job.created_on}`);

	while (
		(jobStatus = (await client.getJobDetails(job.id)).status) === "in_progress"
	) {
		console.log(`Job ${job.id} is ${jobStatus}`);
		await new Promise((resolve) => setTimeout(resolve, 5000));
	}

	let transcriptText = await client.getTranscriptText(job.id);
	// var transcriptTextStream = await client.getTranscriptTextStream(job.id);
	// var transcriptObject = await client.getTranscriptObject(job.id);
	// var transcriptObjectStream = await client.getTranscriptObjectStream(job.id);
	// var captionsStream = await client.getCaptions(job.id);

	fs.writeFileSync(`./downloads/${job.id}.txt`, transcriptText);
	console.log(`${job.id}.txt is saved`);

	return { jobID: job.id, transcriptText };
};

module.exports = { transcribe };
