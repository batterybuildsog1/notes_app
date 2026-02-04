/**
 * Set up Telegram webhook for instant message delivery
 *
 * Usage: node scripts/setup-telegram-webhook.mjs [production-url]
 */

const TELEGRAM_API = "https://api.telegram.org/bot";

async function setupWebhook() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!botToken) {
    console.error("ERROR: TELEGRAM_BOT_TOKEN not set");
    process.exit(1);
  }

  // Get webhook URL from args or use default
  let webhookUrl = process.argv[2];
  if (!webhookUrl) {
    console.error("Usage: node scripts/setup-telegram-webhook.mjs <production-url>");
    console.error("Example: node scripts/setup-telegram-webhook.mjs https://notes.vercel.app");
    process.exit(1);
  }

  // Ensure URL ends with webhook path
  if (!webhookUrl.endsWith("/api/telegram/webhook")) {
    webhookUrl = webhookUrl.replace(/\/$/, "") + "/api/telegram/webhook";
  }

  console.log("Setting up Telegram webhook...");
  console.log(`URL: ${webhookUrl}`);

  try {
    // First, delete any existing webhook
    const deleteResponse = await fetch(`${TELEGRAM_API}${botToken}/deleteWebhook`, {
      method: "POST",
    });
    const deleteResult = await deleteResponse.json();
    console.log("Deleted existing webhook:", deleteResult.ok ? "OK" : deleteResult.description);

    // Set up new webhook
    const body = {
      url: webhookUrl,
      allowed_updates: ["message"],
      drop_pending_updates: true,
    };

    // Add secret token if configured
    if (webhookSecret) {
      body.secret_token = webhookSecret;
      console.log("Using webhook secret for verification");
    }

    const setResponse = await fetch(`${TELEGRAM_API}${botToken}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const setResult = await setResponse.json();

    if (setResult.ok) {
      console.log("\nWebhook set successfully!");

      // Get webhook info to confirm
      const infoResponse = await fetch(`${TELEGRAM_API}${botToken}/getWebhookInfo`);
      const info = await infoResponse.json();

      console.log("\nWebhook Info:");
      console.log(`  URL: ${info.result.url}`);
      console.log(`  Pending updates: ${info.result.pending_update_count}`);
      console.log(`  Has custom certificate: ${info.result.has_custom_certificate}`);
      if (info.result.last_error_message) {
        console.log(`  Last error: ${info.result.last_error_message}`);
      }
    } else {
      console.error("Failed to set webhook:", setResult.description);
      process.exit(1);
    }
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

setupWebhook();
