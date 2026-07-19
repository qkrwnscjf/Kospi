import { Kafka } from 'kafkajs';
import 'dotenv/config';
export const kafka = new Kafka({
    clientId: 'kospi-dashboard',
    brokers: process.env.KAFKA_BROKERS ? process.env.KAFKA_BROKERS.split(',') : ['localhost:9092']
});
export const producer = kafka.producer();
export const consumer = kafka.consumer({ groupId: 'market-group' });
//# sourceMappingURL=kafka.js.map