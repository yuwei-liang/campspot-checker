import axios from 'axios'

class Notifier {
    discordWebhookURL = ""
    constructor(discordWebhookURL) {
        this.discordWebhookURL = discordWebhookURL
    }

    __limitSize(msg, defaultSize = 2000) {
        if (msg.length > defaultSize) {
            msg = msg.substring(0, 500)
            msg = "[Truncated]" + msg
        }

        return msg;
    }

    notify(msg) {
        msg = this.__limitSize(msg)
        // maximum length 2000
        const webhookURL = this.discordWebhookURL
        return axios.post(webhookURL, {
            content: msg
        })
    }

    heartbeat() {
        this.notify('I am alive!');
    }
}

export default Notifier;
