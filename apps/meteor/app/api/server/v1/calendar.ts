import { Calendar } from '@rocket.chat/core-services';
import {
	ajv,
	isCalendarEventListProps,
	isCalendarEventCreateProps,
	isCalendarEventImportProps,
	isCalendarEventInfoProps,
	isCalendarEventUpdateProps,
	isCalendarEventDeleteProps,
	validateUnauthorizedErrorResponse,
} from '@rocket.chat/rest-typings';

import { API } from '../api';

const successWithDataSchema = ajv.compile({
	type: 'object',
	properties: {
		data: {},
		success: { type: 'boolean', enum: [true] },
	},
	required: ['data', 'success'],
	additionalProperties: false,
});

const successWithEventSchema = ajv.compile({
	type: 'object',
	properties: {
		event: { type: 'object' },
		success: { type: 'boolean', enum: [true] },
	},
	required: ['event', 'success'],
	additionalProperties: false,
});

const successWithIdSchema = ajv.compile({
	type: 'object',
	properties: {
		id: { type: 'string' },
		success: { type: 'boolean', enum: [true] },
	},
	required: ['id', 'success'],
	additionalProperties: false,
});

const successSchema = ajv.compile({
	type: 'object',
	properties: { success: { type: 'boolean', enum: [true] } },
	required: ['success'],
	additionalProperties: false,
});

API.v1.get(
	'calendar-events.list',
	{
		authRequired: true,
		query: isCalendarEventListProps,
		rateLimiterOptions: { numRequestsAllowed: 3, intervalTimeInMS: 1000 },
		response: {
			200: successWithDataSchema,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { date } = this.queryParams;

		const data = await Calendar.list(userId, new Date(date));

		return API.v1.success({ data });
	},
);

API.v1.get(
	'calendar-events.info',
	{
		authRequired: true,
		query: isCalendarEventInfoProps,
		rateLimiterOptions: { numRequestsAllowed: 3, intervalTimeInMS: 1000 },
		response: {
			200: successWithEventSchema,
			400: ajv.compile({
				type: 'object',
				properties: { success: { type: 'boolean', enum: [false] }, error: { type: 'string' } },
				required: ['success', 'error'],
				additionalProperties: false,
			}),
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { id } = this.queryParams;

		const event = await Calendar.get(id);

		if (event?.uid !== userId) {
			return API.v1.failure();
		}

		return API.v1.success({ event });
	},
);

API.v1.post(
	'calendar-events.create',
	{
		authRequired: true,
		body: isCalendarEventCreateProps,
		response: {
			200: successWithIdSchema,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId: uid } = this;
		const { startTime, endTime, externalId, subject, description, meetingUrl, reminderMinutesBeforeStart, busy } = this.bodyParams;

		const id = await Calendar.create({
			uid,
			startTime: new Date(startTime),
			...(endTime && { endTime: new Date(endTime) }),
			externalId,
			subject,
			description,
			meetingUrl,
			reminderMinutesBeforeStart,
			...(typeof busy === 'boolean' && { busy }),
		});

		return API.v1.success({ id });
	},
);

API.v1.post(
	'calendar-events.import',
	{
		authRequired: true,
		body: isCalendarEventImportProps,
		response: {
			200: successWithIdSchema,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId: uid } = this;
		const { startTime, endTime, externalId, subject, description, meetingUrl, reminderMinutesBeforeStart, busy } = this.bodyParams;

		const id = await Calendar.import({
			uid,
			startTime: new Date(startTime),
			...(endTime && { endTime: new Date(endTime) }),
			externalId,
			subject,
			description,
			meetingUrl,
			reminderMinutesBeforeStart,
			...(typeof busy === 'boolean' && { busy }),
		});

		return API.v1.success({ id });
	},
);

API.v1.post(
	'calendar-events.update',
	{
		authRequired: true,
		body: isCalendarEventUpdateProps,
		response: {
			200: successSchema,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { eventId, startTime, endTime, subject, description, meetingUrl, reminderMinutesBeforeStart, busy } = this.bodyParams;

		const event = await Calendar.get(eventId);

		if (event?.uid !== userId) {
			throw new Error('invalid-calendar-event');
		}

		await Calendar.update(eventId, {
			startTime: new Date(startTime),
			...(endTime && { endTime: new Date(endTime) }),
			subject,
			description,
			meetingUrl,
			reminderMinutesBeforeStart,
			...(typeof busy === 'boolean' && { busy }),
		});

		return API.v1.success({});
	},
);

API.v1.post(
	'calendar-events.delete',
	{
		authRequired: true,
		body: isCalendarEventDeleteProps,
		response: {
			200: successSchema,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId } = this;
		const { eventId } = this.bodyParams;

		const event = await Calendar.get(eventId);

		if (event?.uid !== userId) {
			throw new Error('invalid-calendar-event');
		}

		await Calendar.delete(eventId);

		return API.v1.success({});
	},
);
