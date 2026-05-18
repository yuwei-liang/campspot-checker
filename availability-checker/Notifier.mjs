import axios from 'axios'

const DISCORD_MAX_LENGTH = 2000
const TRUNCATION_SUFFIX = '\n...[truncated]'
const NTFY_MAX_ACTIONS = 3

class Notifier {
    constructor(discordWebhookURL, ntfyTopicURL = null) {
        this.discordWebhookURL = discordWebhookURL
        this.ntfyTopicURL = ntfyTopicURL || null
    }

    __limitSize(msg, maxLength = DISCORD_MAX_LENGTH) {
        if (msg.length <= maxLength) {
            return msg
        }
        return msg.substring(0, maxLength - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX
    }

    // ntfy.sh action button syntax. Labels are double-quoted so embedded commas
    // and semicolons in campground names won't break the header parser.
    __buildNtfyHeaders({ title, clickUrl, actions } = {}) {
        const headers = { 'Content-Type': 'text/plain', 'Priority': '5' }
        if (title) headers.Title = title
        if (clickUrl) headers.Click = clickUrl
        if (Array.isArray(actions) && actions.length > 0) {
            const formatted = actions.slice(0, NTFY_MAX_ACTIONS).map(a => {
                const label = JSON.stringify(String(a.label ?? ''))
                return `view, ${label}, ${a.url}, clear=true`
            }).join('; ')
            headers.Actions = formatted
        }
        return headers
    }

    notify(msg, options = {}) {
        const trimmed = this.__limitSize(msg)
        const tasks = []
        if (this.discordWebhookURL) {
            tasks.push(
                axios.post(this.discordWebhookURL, { content: trimmed })
                    .catch(err => global.logger?.error?.(`discord notify: ${err.message}`))
            )
        }
        if (this.ntfyTopicURL) {
            tasks.push(
                axios.post(this.ntfyTopicURL, trimmed, {
                    headers: this.__buildNtfyHeaders(options),
                    timeout: 10000,
                }).catch(err => global.logger?.error?.(`ntfy notify: ${err.message}`))
            )
        }
        return Promise.allSettled(tasks)
    }

    // Heartbeats stay Discord-only — no point loud-pushing "I am alive" to the
    // user's phone every 30 minutes.
    heartbeat() {
        if (!this.discordWebhookURL) return Promise.resolve()
        return axios.post(this.discordWebhookURL, { content: 'I am alive!' })
            .catch(err => global.logger?.error?.(`discord heartbeat: ${err.message}`))
    }
}

export default Notifier;
