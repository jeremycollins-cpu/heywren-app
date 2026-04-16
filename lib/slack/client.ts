import { WebClient } from '@slack/web-api'
import axios from 'axios'

const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN)

export async function getSlackUser(userId: string) {
  try {
    const result = await slackClient.users.info({ user: userId })
    return result.user
  } catch (error) {
    console.error('Failed to get Slack user:', error)
    return null
  }
}

export async function getSlackMessage(
  channelId: string,
  timestamp: string
) {
  try {
    const result = await slackClient.conversations.history({
      channel: channelId,
      latest: timestamp,
      limit: 1,
      inclusive: true,
    })
    return result.messages?.[0]
  } catch (error) {
    console.error('Failed to get Slack message:', error)
    return null
  }
}

export async function sendDMToSlackUser(
  userId: string,
  message: string
) {
  try {
    const result = await slackClient.conversations.open({ users: userId })
    if (!result.channel?.id) return null

    await slackClient.chat.postMessage({
      channel: result.channel.id,
      text: message,
    })
    return result.channel
  } catch (error) {
    console.error('Failed to send DM:', error)
    return null
  }
}

export async function postMessageToChannel(
  channelId: string,
  message: string,
  blocks?: any[]
) {
  try {
    const result = await slackClient.chat.postMessage({
      channel: channelId,
      text: message,
      blocks,
    })
    return result
  } catch (error) {
    console.error('Failed to post message:', error)
    return null
  }
}

export async function getSlackTeamInfo(teamId: string) {
  try {
    const result = await slackClient.team.info()
    return result.team
  } catch (error) {
    console.error('Failed to get team info:', error)
    return null
  }
}

export async function verifySlackSignature(
  timestamp: string,
  signature: string,
  body: string
): Promise<boolean> {
  const crypto = require('crypto')

  // Reject requests older than 5 minutes to prevent replay attacks
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5
  if (parseInt(timestamp) < fiveMinutesAgo) {
    console.warn('Slack signature verification failed — timestamp too old (possible replay attack)')
    return false
  }

  const baseString = `v0:${timestamp}:${body}`
  const mySignature =
    'v0=' +
    crypto
      .createHmac('sha256', process.env.SLACK_SIGNING_SECRET!)
      .update(baseString)
      .digest('hex')

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(mySignature)
  )
}

export async function exchangeSlackCode(code: string, redirectUri: string) {
  try {
    const response = await axios.post('https://slack.com/api/oauth.v2.access', {
      client_id: process.env.SLACK_CLIENT_ID,
      client_secret: process.env.SLACK_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    })

    if (!response.data.ok) {
      throw new Error(response.data.error)
    }

    return response.data
  } catch (error) {
    console.error('Failed to exchange Slack code:', error)
    throw error
  }
}
