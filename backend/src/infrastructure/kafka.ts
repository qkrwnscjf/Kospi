import { Kafka } from 'kafkajs';
import type { KafkaMessage, Producer } from 'kafkajs';
import 'dotenv/config';

export const kafka = new Kafka({
  clientId: 'kospi-dashboard',
  brokers: process.env.KAFKA_BROKERS ? process.env.KAFKA_BROKERS.split(',') : ['localhost:9092']
});

export const producer = kafka.producer();
export const consumer = kafka.consumer({ groupId: 'market-group' });

// 토픽 구성 (docs/Task_ORDER.md T-11, D-17)
export const TOPICS = {
  ticks: 'market-ticks',
  dlq: 'market-ticks.dlq',
} as const;

const TICKS_PARTITIONS = Number.parseInt(process.env.KAFKA_TOPIC_PARTITIONS ?? '', 10) || 1;
const TICKS_RETENTION_MS = 24 * 60 * 60 * 1000; // 24시간: DB Sink가 하루 멈춰도 다시 채울 수 있는 재처리 버퍼
const DLQ_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7일: 잘못된 메시지 원인 분석용

// 토픽이 없으면 만든다. worker, Gateway, DB Sink가 시작할 때 각자 호출하므로 어느 쪽이 먼저 떠도 같은 설정으로 만들어진다.
// 이미 있으면 그대로 두고, 파티션 수가 설정과 다르면 경고만 남긴다 (파티션은 줄일 수 없어서 자동으로 바꾸지 않는다).
export async function ensureTopics() {
  const admin = kafka.admin();
  await admin.connect();
  try {
    try {
      await admin.createTopics({
        waitForLeaders: true,
        topics: [
          {
            topic: TOPICS.ticks,
            numPartitions: TICKS_PARTITIONS,
            replicationFactor: 1,
            configEntries: [{ name: 'retention.ms', value: String(TICKS_RETENTION_MS) }],
          },
          {
            topic: TOPICS.dlq,
            numPartitions: 1,
            replicationFactor: 1,
            configEntries: [{ name: 'retention.ms', value: String(DLQ_RETENTION_MS) }],
          },
        ],
      });
    } catch (error) {
      // 여러 서비스가 동시에 만들려고 하면 "이미 있음" 에러가 날 수 있다. 아래 메타데이터 확인으로 판단한다.
      console.warn(`createTopics: ${error instanceof Error ? error.message : String(error)}`);
    }

    const metadata = await admin.fetchTopicMetadata({ topics: [TOPICS.ticks, TOPICS.dlq] });
    const ticks = metadata.topics.find(topic => topic.name === TOPICS.ticks);
    if (!ticks || !metadata.topics.some(topic => topic.name === TOPICS.dlq)) {
      throw new Error('Kafka topics are missing after ensureTopics');
    }
    if (ticks.partitions.length !== TICKS_PARTITIONS) {
      console.warn(`Topic ${TOPICS.ticks} has ${ticks.partitions.length} partitions, configured ${TICKS_PARTITIONS}.`);
    }
    return ticks.partitions.length;
  } finally {
    await admin.disconnect();
  }
}

// 잘못된 메시지를 원본 그대로 DLQ에 보낸다 (docs/Task_ORDER.md T-13, D-19).
// 실패해도 예외를 던지지 않는다. 컨슈머가 같은 메시지에서 멈추지 않게 하기 위함.
export async function sendToDlq(
  dlqProducer: Producer,
  source: { consumer: string; topic: string; partition: number; message: KafkaMessage; reason: string }
) {
  try {
    await dlqProducer.send({
      topic: TOPICS.dlq,
      messages: [{
        key: source.message.key,
        value: source.message.value,
        headers: {
          reason: source.reason,
          consumer: source.consumer,
          'source-topic': source.topic,
          'source-partition': String(source.partition),
          'source-offset': source.message.offset,
        },
      }],
    });
  } catch (error) {
    console.error(`Failed to send message to DLQ: ${error instanceof Error ? error.message : String(error)}`);
  }
}
