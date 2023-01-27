import axios from 'axios'

class Notifier {
    discordWebhookURL = ""
    constructor(discordWebhookURL) {
        this.discordWebhookURL = discordWebhookURL
    }

    notify(msg) {
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
