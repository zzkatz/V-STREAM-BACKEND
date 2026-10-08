import axios from "axios";
import { ApiError } from "./ApiError.js";

async function checkEmailExists(email) {
    try {
        const response = await axios.get(`https://api.apilayer.net/mailboxlayer/api/check`, {
            params: {
                access_key: process.env.EMAIL_VALIDATION_KEY, // Ensure this is set in your environment
                email: email,
                smtp: 1, // Enable SMTP validation
                format: 1, // Enable formatted response
            },
        });

        const data = response.data;

        if (data.format_valid && data.smtp_check) {
            return true;
        } else {
            return false;
        }
    } catch (error) {
        console.error("Email validation error:", error?.response?.data || error.message);
        throw new ApiError(500, "Email validation service is unavailable");
    }
}

/*
@abhaytaras 
 !!!! Design Decision !!!!

(disposable) property from mailboxlayer api can be used to check disposable emails
 
But due to budget concerns I've decided to go with Sets

SOURCE : https://mailboxlayer.com/documentation
 
*/
const disposableEmailDomains = new Set([
    "tempmail.com", "10minutemail.com", "mailinator.com", "guerrillamail.com",
    "dispostable.com", "yopmail.com", "fakeinbox.com", "maildrop.cc"
]);

function isDisposableEmail(email) {
    const domain = email.split("@").pop();
    return disposableEmailDomains.has(domain);
}



export { checkEmailExists, isDisposableEmail };
