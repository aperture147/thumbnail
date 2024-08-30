import { AwsClient } from 'aws4fetch'
import { Address4, Address6 } from 'ip-address'
import { isbot } from "isbot";
import { PhotonImage, watermark } from "@cf-wasm/photon";

const PRESIGNED_URL_TIMEOUT = "60"

const GOOGLE_BOT_IP_RANGE_URL = "https://developers.google.com/static/search/apis/ipranges/googlebot.json"
const GOOGLE_SPECIAL_CRAWLERS_IP_RANGE_URL = "https://developers.google.com/static/search/apis/ipranges/special-crawlers.json"
const GOOGLE_USER_TRIGGERED_FETCHERS_IP_RANGE_URL = "https://developers.google.com/static/search/apis/ipranges/user-triggered-fetchers.json"
const GOOGLE_USER_TRIGGERED_FETCHERS_GOOGLE_IP_RANGE_URL = "https://developers.google.com/static/search/apis/ipranges/user-triggered-fetchers-google.json"
const BING_BOT_IP_RANGE_URL = "https://www.bing.com/toolbox/bingbot.json"
const APPLE_BOT_IP_RANGE_URL = "https://search.developer.apple.com/applebot.json"

const IP_RANGE_LIST = [
	GOOGLE_BOT_IP_RANGE_URL,
	GOOGLE_SPECIAL_CRAWLERS_IP_RANGE_URL,
	GOOGLE_USER_TRIGGERED_FETCHERS_IP_RANGE_URL,
	GOOGLE_USER_TRIGGERED_FETCHERS_GOOGLE_IP_RANGE_URL,
	BING_BOT_IP_RANGE_URL,
	APPLE_BOT_IP_RANGE_URL
]

const ROBOTS_TXT = `# Allow search engine bots
User-agent: Googlebot
Allow: /
User-agent: Bingbot
Allow: /
User-agent: Baiduspider
Allow: /
User-agent: YandexBot
Allow: /
User-agent: NaverBot
Allow: /
User-agent: DuckDuckBot
Allow: /
User-agent: Applebot
Allow: /
User-agent: seznambot
Allow: /
User-agent: msnbot
Allow: /
User-agent: Slurp
Allow: /

# Allow social media bots
User-agent: facebookexternalhit
Allow: /
User-agent: Twitterbot
Allow: /
User-agent: LinkedInBot
Allow: /
User-agent: Discordbot
Allow: /
User-agent: Pinterestbot
Allow: /
User-agent: TelegramBot
Allow: /

# Allow SEO tools
User-agent: Screaming Frog SEO Spider
Allow: /

# Disallow all bots
User-agent: *
Disallow: /
`

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
	const cacheKey = Math.floor(Date.now() / 900000) // cache for 15 minutes
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

const getPhotonImage = async (url: string | URL) => {
	const watermarkBuf = await fetch(url)
		.then((res) => res.arrayBuffer())
      	.then((buffer) => new Uint8Array(buffer));
	return PhotonImage.new_from_byteslice(watermarkBuf)
}


let WATERMARK_IMAGE: PhotonImage | null = null

const _getWatermarkImage = async () => {
	if (!WATERMARK_IMAGE) {
		WATERMARK_IMAGE = PhotonImage.new_from_base64('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')
	}
	return WATERMARK_IMAGE
}

const TRAILING_SLASH_REGEX = /\/+$/;

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const cache = caches.default
		let requestURL = new URL(request.url)
		// remove trailing slash
		requestURL.pathname = requestURL.pathname.replace(TRAILING_SLASH_REGEX, "")
		if (requestURL.pathname === "/robots.txt") {
			return new Response(ROBOTS_TXT, {
				headers: {
					'Content-Type': 'text/plain'
				}
			})
		}
		requestURL = new URL(requestURL.origin + requestURL.pathname)
		let needWatermark = true

		const userAgent = request.headers.get("User-Agent")
		if (userAgent && isbot(userAgent)) needWatermark = false

		if (needWatermark) {
			const clientIP = request.headers.get("CF-Connecting-IP")
			if (clientIP) {
				const isABot = await isKnownBotIPAddress(clientIP)
				if (isABot) needWatermark = false
			}
		}

		// NOTE: Disable needWatermark for Referer check for now
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
		const imageResponse = await fetch(signed)
		
		const img = PhotonImage.new_from_byteslice(new Uint8Array(await imageResponse.arrayBuffer()))
		const watermarkImg = await _getWatermarkImage()
		if (needWatermark) {
			const x = BigInt(img.get_width() - watermarkImg.get_width())
			const y = BigInt(img.get_height() - watermarkImg.get_height())
			watermark(img, watermarkImg, x, y)
		}
		
		// Must use Response constructor to inherit all of response's fields
		// Reference: https://developers.cloudflare.com/workers/examples/cache-api/
		response = new Response(img.get_bytes_webp(), imageResponse)
		response.headers.set("Cache-Control", "public, max-age=31536000, s-maxage=31536000")
		
		ctx.waitUntil(cache.put(requestURLString, response.clone()))
		
		img.free()

		return response
	},
};
