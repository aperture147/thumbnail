import { AwsClient } from 'aws4fetch'
import { Address4, Address6 } from 'ip-address'

const PRESIGNED_URL_TIMEOUT = "60"
const CACHE = caches.default

const GOOGLE_BOT_IP_RANGE_URL = "https://developers.google.com/static/search/apis/ipranges/googlebot.json"

interface IPPrefix {
	ipv6Prefix?: string
	ipv4Prefix?: string
}
interface IPRangeResponse {
	creationTime: string,
	prefixes: IPPrefix[]
}

interface ParsedIPRangeDict {
	ipv4: Address4[]
	ipv6: Address6[]
}

let CACHED_IP_PREFIX = new Map<number, ParsedIPRangeDict>()

const getParsedIDRangeDict = async (): Promise<ParsedIPRangeDict> => {
	const cacheKey = Math.floor(Date.now() / 300000) // cache for 5 minutes
	let parsedIPRangeDict = CACHED_IP_PREFIX.get(cacheKey)
	if (parsedIPRangeDict !== undefined)
		return parsedIPRangeDict

	const resp = await fetch(GOOGLE_BOT_IP_RANGE_URL)
	const ipRangeResponse = (await resp.json()) as IPRangeResponse
	parsedIPRangeDict = {
		ipv4: [],
		ipv6: []
	} as ParsedIPRangeDict
	
	for (const prefix of ipRangeResponse.prefixes) {
		if (prefix.ipv4Prefix !== undefined)
			parsedIPRangeDict.ipv4.push(new Address4(prefix.ipv4Prefix))
		else if (prefix.ipv6Prefix !== undefined)
			parsedIPRangeDict.ipv6.push(new Address6(prefix.ipv6Prefix))
	}
	CACHED_IP_PREFIX.clear()
	CACHED_IP_PREFIX.set(cacheKey, parsedIPRangeDict)
	return parsedIPRangeDict
}

const isGoogleBot = async (ipAddress: string) => {
	const parsedIDRangeDict = await getParsedIDRangeDict()
	let address = null
	let subnetList = []
	if (ipAddress.includes(':')) { // IPv6
		address = new Address6(ipAddress);
		subnetList = parsedIDRangeDict.ipv6
	} else { // IPv4
		address = new Address4(ipAddress);
		subnetList = parsedIDRangeDict.ipv4
	}

	for (const subnet of subnetList)
		if (address.isInSubnet(subnet))
			return true
	
	return false
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const requestURL = new URL(request.url)
		const clientIP = request.headers.get("CF-Connecting-IP")
		let isGGBot = false
		if (clientIP !== null) {
			isGGBot = await isGoogleBot(clientIP)
			if (isGGBot)
				requestURL.searchParams.append("is_google_bot", 'true')
		}

		let response = await CACHE.match(requestURL, { ignoreMethod: true })
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
		const options: RequestInit<RequestInitCfProperties> = {
			headers: request.headers,
		}
		if (!isGGBot) {
			options.cf = {
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
		}

		// @ts-expect-error
		response = await fetch(signed, options)
		const cachingResponse = response?.clone()
		// @ts-expect-error
		await CACHE.put(request.url, cachingResponse)
		// @ts-expect-error
		return response
	},
};
