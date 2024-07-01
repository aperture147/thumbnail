import { AwsClient } from 'aws4fetch'

const PRESIGNED_URL_TIMEOUT = "60"


export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const cache = caches.default
		let response = await cache.match(request.url, {
			ignoreMethod: true
		})
		if (response !== undefined)
			return response
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
		
		// @ts-expect-error
		response = await fetch(signed, {
			cf: {
				image: {
					draw: [{
						url: 'https://i.imgur.com/xWbJByr_d.webp?maxwidth=1520&fidelity=grand',
						bottom: 0,
						right: 0,
						fit: 'contain',
						width: 250,
						height: 250,
						opacity: 1,
					}]
				}
			}
		})
		// @ts-expect-error
		await cache.put(request.url, response)
		// @ts-expect-error
		return response
	},
};
