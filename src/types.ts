export interface JetstreamEvent {
	did: string;
	time_us: number;
	kind: "commit" | "identity" | "account";
	commit?: {
		rev: string;
		operation: "create" | "update" | "delete";
		collection: string;
		rkey: string;
		record?: any;
		cid?: string;
	};
	identity?: {
		did: string;
		handle: string;
		seq: number;
		time: string;
	};
	account?: {
		active: boolean;
		did: string;
		seq: number;
		time: string;
	};
}

export interface StoredStats {
	cursor: number;
	eventCounts: Record<string, number>;
	totalEvents: number;
	totalReceived: number;
	lastEventTime: string;
}

export interface QueueMessage {
	event: JetstreamEvent;
	queuedAt: string;
	retryCount?: number;
} 