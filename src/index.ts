import { AwsClient } from 'aws4fetch'

const PRESIGNED_URL_TIMEOUT = "60"

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const r2_client = new AwsClient({
			accessKeyId: env.S3_ACCESS_KEY_ID,
			secretAccessKey: env.S3_SECRET_ACCESS_KEY,
		})
		const url = new URL(request.url)
		url.hostname = `${env.BUCKET_NAME}.${env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`
		url.protocol = `https:`
		url.searchParams.set("X-Amz-Expires", PRESIGNED_URL_TIMEOUT)
		url.port = "443"
		const signed = await r2_client.sign(
			new Request(url, {
			  method: "GET",
			}),
			{
				aws: { signQuery: true },
			}
		);
		const response = await fetch(signed, {
			cf: {
				image: {
					draw: [{
						url: 'https://picsum.photos/id/237/100',
						bottom: 5,
						right: 5,
						fit: 'contain',
						width: 100,
						height: 100,
						opacity: 0.4,
					}]
				}
			}
		})
		// @ts-expect-error
		return new Response(response.body, response)
	},
};
