import { AwsClient } from 'aws4fetch'
import { Address4, Address6 } from 'ip-address'
import { isbot } from "isbot";

const PRESIGNED_URL_TIMEOUT = "60"

const GOOGLE_BOT_IP_RANGE_URL = "https://developers.google.com/static/search/apis/ipranges/googlebot.json"
const GOOGLE_SPECIAL_CRAWLERS_IP_RANGE_URL = "https://developers.google.com/static/search/apis/ipranges/special-crawlers.json"
const GOOGLE_USER_TRIGGERED_FETCHERS_IP_RANGE_URL = "https://developers.google.com/static/search/apis/ipranges/user-triggered-fetchers.json"
const GOOGLE_USER_TRIGGERED_FETCHERS_GOOGLE_IP_RANGE_URL = "https://developers.google.com/static/search/apis/ipranges/user-triggered-fetchers-google.json"
const BING_BOT_IP_RANGE_URL = "https://www.bing.com/toolbox/bingbot.json"

const IP_RANGE_LIST = [
	GOOGLE_BOT_IP_RANGE_URL,
	GOOGLE_SPECIAL_CRAWLERS_IP_RANGE_URL,
	GOOGLE_USER_TRIGGERED_FETCHERS_IP_RANGE_URL,
	GOOGLE_USER_TRIGGERED_FETCHERS_GOOGLE_IP_RANGE_URL,
	BING_BOT_IP_RANGE_URL
]

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
	parsedIPRangeDict = {
		ipv4: [],
		ipv6: []
	} as ParsedIPRangeDict
	for (const url of IP_RANGE_LIST) {
		const resp = await fetch(url)
		const ipRangeResponse = (await resp.json()) as IPRangeResponse

		for (const prefix of ipRangeResponse.prefixes) {
			if (prefix.ipv4Prefix !== undefined)
				parsedIPRangeDict.ipv4.push(new Address4(prefix.ipv4Prefix))
			else if (prefix.ipv6Prefix !== undefined)
				parsedIPRangeDict.ipv6.push(new Address6(prefix.ipv6Prefix))
		}
	}
	CACHED_IP_PREFIX.clear()
	CACHED_IP_PREFIX.set(cacheKey, parsedIPRangeDict)
	return parsedIPRangeDict
}

const isKnownBotIPAddress = async (ipAddress: string) => {
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
		const cache = caches.default
		let requestURL = new URL(request.url)
		requestURL = new URL(requestURL.origin + requestURL.pathname)

		let needWatermark = true

		if (needWatermark) {
			const userAgent = request.headers.get("User-Agent")
			if (userAgent !== null) {
				if (isbot(userAgent)) needWatermark = false
			}
		}

		if (needWatermark) {
			const clientIP = request.headers.get("CF-Connecting-IP")
			if (clientIP !== null) {
				const isABot = await isKnownBotIPAddress(clientIP)
				if (isABot) needWatermark = false
			}
		}

		// NOTE: Disable needwatermark check for now
		// if (needWatermark) {
		// 	const referer = request.headers.get("Referer")
		// 	if (referer && (referer !== undefined) && !referer.startsWith("https://3dmaxter.com/"))
		// 		needWatermark = false
		// }

		if (needWatermark) {
			requestURL.searchParams.append("need_watermark", 'true')
		}

		const requestURLString = requestURL.toString()
		
		let response = await cache.match(requestURLString, { ignoreMethod: true })
		if (response !== undefined)
			return response

		const r2Client = new AwsClient({
			accessKeyId: env.S3_ACCESS_KEY_ID,
			secretAccessKey: env.S3_SECRET_ACCESS_KEY,
		})
		const url = new URL(request.url)
		url.hostname = `${env.BUCKET_NAME}.${env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`
		url.protocol = `https:`
		url.searchParams.set("X-Amz-Expires", PRESIGNED_URL_TIMEOUT)
		url.port = "443"
		const signed = await r2Client.sign(
			new Request(url, {
				method: "GET",
			}),
			{
				aws: { signQuery: true },
			}
		);
		const options: RequestInit<RequestInitCfProperties> = {}
		if (needWatermark) {
			options.cf = {
				image: {
					draw: [{
						url: 'https://i.imgur.com/xWbJByr.png',
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
		// Must use Response constructor to inherit all of response's fields
		// Reference: https://developers.cloudflare.com/workers/examples/cache-api/
		response = new Response(response?.body, response)
		ctx.waitUntil(cache.put(requestURLString, response.clone()))
		
		return response
	},
};
