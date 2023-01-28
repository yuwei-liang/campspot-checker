import axios from 'axios'

class Notifier {
    discordWebhookURL = ""
    constructor(discordWebhookURL) {
        this.discordWebhookURL = discordWebhookURL
    }

    notify(msg) {
        // maximum length 2000
        msg = msg.substring(0, 500)
        msg = "[Truncated]" + msg
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
