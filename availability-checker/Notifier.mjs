import axios from 'axios'

const DISCORD_MAX_LENGTH = 2000
const TRUNCATION_SUFFIX = '\n...[truncated]'

class Notifier {
    discordWebhookURL = ""
    constructor(discordWebhookURL) {
        this.discordWebhookURL = discordWebhookURL
    }

    __limitSize(msg, maxLength = DISCORD_MAX_LENGTH) {
        if (msg.length <= maxLength) {
            return msg
        }
        return msg.substring(0, maxLength - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX
    }

    notify(msg) {
        msg = this.__limitSize(msg)
        return axios.post(this.discordWebhookURL, { content: msg })
    }

    heartbeat() {
        this.notify('I am alive!');
    }
}

export default Notifier;
