import axios from 'axios'
import winston from 'winston'

class Notifier {
    logger;
    discordWebhookURL = ""
    constructor(discordWebhookURL) {
        this.discordWebhookURL = discordWebhookURL
        this.logger = winston.createLogger({
            level: 'info',
            // format: combine(
            //     timestamp(),
            //     myFormat
            // ),
            defaultMeta: { service: 'user-service' },
            transports: [
                //
                // - Write all logs with importance level of `error` or less to `error.log`
                // - Write all logs with importance level of `info` or less to `combined.log`
                //
                new winston.transports.File({ filename: 'log/error.log', level: 'error' }),
                new winston.transports.File({ filename: 'log/combined.log' }),
            ],
        });
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
        .catch((error) => {
            this.logger.error(error)
        })
    }

    heartbeat() {
        this.notify('I am alive!');
    }
}

export default Notifier;
