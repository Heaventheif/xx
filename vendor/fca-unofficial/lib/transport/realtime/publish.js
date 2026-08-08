export async function publishRealtimeMessage(params) {
  const {
    client,
    topic,
    payload,
    qos = 1,
    retain = false
  } = params;
  if (!client || typeof client.publish !== "function") {
    throw new Error("MQTT client is not initialized");
  }
  await new Promise((resolve, reject) => {
    const body = typeof payload === "string" ? payload : JSON.stringify(payload);
    client.publish(topic, body, {
      qos,
      retain
    }, err => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}
export default {
  publishRealtimeMessage
};