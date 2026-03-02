import type { IModerationReport, IUser, IUserEmail } from '@rocket.chat/core-typings';
import { ModerationReports, Users } from '@rocket.chat/models';
import {
	ajv,
	isReportHistoryProps,
	isArchiveReportProps,
	isReportInfoParams,
	isGetUserReportsParams,
	isModerationReportUserPost,
	isModerationDeleteMsgHistoryParams,
	isReportsByMsgIdParams,
	validateUnauthorizedErrorResponse,
	validateForbiddenErrorResponse,
	validateBadRequestErrorResponse,
} from '@rocket.chat/rest-typings';
import { escapeRegExp } from '@rocket.chat/string-helpers';

import { deleteReportedMessages } from '../../../../server/lib/moderation/deleteReportedMessages';
import { API } from '../api';
import { getPaginationItems } from '../helpers/getPaginationItems';

type ReportMessage = Pick<IModerationReport, '_id' | 'message' | 'ts' | 'room'>;

const paginatedReportsResponseSchema = ajv.compile({
	type: 'object',
	properties: {
		reports: { type: 'array', items: { type: 'object' } },
		count: { type: 'number' },
		offset: { type: 'number' },
		total: { type: 'number' },
		success: { type: 'boolean', enum: [true] },
	},
	required: ['reports', 'count', 'offset', 'total', 'success'],
	additionalProperties: false,
});

const reportedMessagesResponseSchema = ajv.compile({
	type: 'object',
	properties: {
		user: { type: ['object', 'null'] },
		messages: { type: 'array', items: { type: 'object' } },
		count: { type: 'number' },
		total: { type: 'number' },
		offset: { type: 'number' },
		success: { type: 'boolean', enum: [true] },
	},
	required: ['user', 'messages', 'count', 'total', 'offset', 'success'],
	additionalProperties: false,
});

const reportsByUserIdResponseSchema = ajv.compile({
	type: 'object',
	properties: {
		user: { type: ['object', 'null'] },
		reports: { type: 'array', items: { type: 'object' } },
		count: { type: 'number' },
		total: { type: 'number' },
		offset: { type: 'number' },
		success: { type: 'boolean', enum: [true] },
	},
	required: ['user', 'reports', 'count', 'total', 'offset', 'success'],
	additionalProperties: false,
});

const successResponseSchema = ajv.compile({
	type: 'object',
	properties: { success: { type: 'boolean', enum: [true] } },
	required: ['success'],
	additionalProperties: false,
});

const reportInfoResponseSchema = ajv.compile({
	type: 'object',
	properties: {
		report: { type: ['object', 'null'] },
		success: { type: 'boolean', enum: [true] },
	},
	required: ['report', 'success'],
	additionalProperties: false,
});

API.v1.get(
	'moderation.reportsByUsers',
	{
		authRequired: true,
		permissionsRequired: ['view-moderation-console'],
		query: isReportHistoryProps,
		response: {
			200: paginatedReportsResponseSchema,
			401: validateUnauthorizedErrorResponse,
			403: validateForbiddenErrorResponse,
		},
	},
	async function action() {
		const { latest: _latest, oldest: _oldest, selector = '' } = this.queryParams;

		const { count = 20, offset = 0 } = await getPaginationItems(this.queryParams);
		const { sort } = await this.parseJsonQuery();

		const latest = _latest ? new Date(_latest) : new Date();
		const oldest = _oldest ? new Date(_oldest) : new Date(0);

		const escapedSelector = escapeRegExp(selector);

		const reports = await ModerationReports.findMessageReportsGroupedByUser(latest, oldest, escapedSelector, {
			offset,
			count,
			sort,
		}).toArray();

		if (reports.length === 0) {
			return API.v1.success({
				success: true,
				reports,
				count: 0,
				offset,
				total: 0,
			});
		}

		const total = await ModerationReports.getTotalUniqueReportedUsers(latest, oldest, escapedSelector, true);

		return API.v1.success({
			success: true,
			reports,
			count: reports.length,
			offset,
			total,
		});
	},
);

API.v1.get(
	'moderation.userReports',
	{
		authRequired: true,
		permissionsRequired: ['view-moderation-console'],
		query: isReportHistoryProps,
		response: {
			200: paginatedReportsResponseSchema,
			401: validateUnauthorizedErrorResponse,
			403: validateForbiddenErrorResponse,
		},
	},
	async function action() {
		const { latest: _latest, oldest: _oldest, selector = '' } = this.queryParams;

		const { count = 20, offset = 0 } = await getPaginationItems(this.queryParams);

		const { sort } = await this.parseJsonQuery();

		const latest = _latest ? new Date(_latest) : new Date();

		const oldest = _oldest ? new Date(_oldest) : new Date(0);

		const escapedSelector = escapeRegExp(selector);

		const reports = await ModerationReports.findUserReports(latest, oldest, escapedSelector, {
			offset,
			count,
			sort,
		}).toArray();

		if (reports.length === 0) {
			return API.v1.success({
				success: true,
				reports,
				count: 0,
				offset,
				total: 0,
			});
		}

		const total = await ModerationReports.getTotalUniqueReportedUsers(latest, oldest, escapedSelector);

		return API.v1.success({
			success: true,
			reports,
			count: reports.length,
			offset,
			total,
		});
	},
);

API.v1.get(
	'moderation.user.reportedMessages',
	{
		authRequired: true,
		permissionsRequired: ['view-moderation-console'],
		query: isGetUserReportsParams,
		response: {
			200: reportedMessagesResponseSchema,
			401: validateUnauthorizedErrorResponse,
			403: validateForbiddenErrorResponse,
		},
	},
	async function action() {
		const { userId, selector = '' } = this.queryParams;

		const { sort } = await this.parseJsonQuery();

		const { count = 50, offset = 0 } = await getPaginationItems(this.queryParams);

		const user = await Users.findOneById<Pick<IUser, '_id' | 'username' | 'name'>>(userId, {
			projection: { _id: 1, username: 1, name: 1 },
		});

		const escapedSelector = escapeRegExp(selector);

		const { cursor, totalCount } = ModerationReports.findReportedMessagesByReportedUserId(userId, escapedSelector, {
			offset,
			count,
			sort,
		});

		const [reports, total] = await Promise.all([cursor.toArray(), totalCount]);

		const uniqueMessages: ReportMessage[] = [];
		const visited = new Set<string>();
		for (const report of reports) {
			if (visited.has(report.message._id)) {
				continue;
			}
			visited.add(report.message._id);
			uniqueMessages.push(report);
		}

		return API.v1.success({
			success: true,
			user,
			messages: uniqueMessages,
			count: reports.length,
			total,
			offset,
		});
	},
);

API.v1.get(
	'moderation.user.reportsByUserId',
	{
		authRequired: true,
		permissionsRequired: ['view-moderation-console'],
		query: isGetUserReportsParams,
		response: {
			200: reportsByUserIdResponseSchema,
			401: validateUnauthorizedErrorResponse,
			403: validateForbiddenErrorResponse,
		},
	},
	async function action() {
		const { userId, selector = '' } = this.queryParams;
		const { sort } = await this.parseJsonQuery();
		const { count = 50, offset = 0 } = await getPaginationItems(this.queryParams);

		const user = await Users.findOneById<IUser>(userId, {
			projection: {
				_id: 1,
				username: 1,
				name: 1,
				avatarETag: 1,
				active: 1,
				roles: 1,
				emails: 1,
				createdAt: 1,
			},
		});

		const escapedSelector = escapeRegExp(selector);
		const { cursor, totalCount } = ModerationReports.findUserReportsByReportedUserId(userId, escapedSelector, {
			offset,
			count,
			sort,
		});

		const [reports, total] = await Promise.all([cursor.toArray(), totalCount]);

		const emailSet = new Map<IUserEmail['address'], IUserEmail>();

		reports.forEach((report) => {
			const email = report.reportedUser?.emails?.[0];
			if (email) {
				emailSet.set(email.address, email);
			}
		});
		if (user) {
			user.emails = Array.from(emailSet.values());
		}

		return API.v1.success({
			success: true,
			user,
			reports,
			count: reports.length,
			total,
			offset,
		});
	},
);

API.v1.post(
	'moderation.user.deleteReportedMessages',
	{
		authRequired: true,
		permissionsRequired: ['manage-moderation-actions'],
		body: isModerationDeleteMsgHistoryParams,
		response: {
			200: successResponseSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
			403: validateForbiddenErrorResponse,
		},
	},
	async function action() {
		const { userId, reason } = this.bodyParams;

		const sanitizedReason = reason?.trim() ? reason : 'No reason provided';

		const { user: moderator } = this;

		const { count = 50, offset = 0 } = await getPaginationItems(this.queryParams);

		const { cursor, totalCount } = ModerationReports.findReportedMessagesByReportedUserId(userId, '', {
			offset,
			count,
			sort: { ts: -1 },
		});

		const [messages, total] = await Promise.all([cursor.toArray(), totalCount]);

		if (total === 0) {
			return API.v1.failure('No reported messages found for this user.');
		}

		await deleteReportedMessages(
			messages.map((message) => message.message),
			moderator,
		);

		await ModerationReports.hideMessageReportsByUserId(userId, this.userId, sanitizedReason, 'DELETE Messages');

		return API.v1.success({ success: true });
	},
);

API.v1.post(
	'moderation.dismissReports',
	{
		authRequired: true,
		permissionsRequired: ['manage-moderation-actions'],
		body: isArchiveReportProps,
		response: {
			200: successResponseSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
			403: validateForbiddenErrorResponse,
		},
	},
	async function action() {
		const { userId, msgId, reason, action: actionParam } = this.bodyParams;

		if (userId) {
			const report = await ModerationReports.findOne({ 'message.u._id': userId, '_hidden': { $ne: true } }, { projection: { _id: 1 } });
			if (!report) {
				return API.v1.failure('no-reports-found');
			}
		}

		if (msgId) {
			const report = await ModerationReports.findOne({ 'message._id': msgId, '_hidden': { $ne: true } }, { projection: { _id: 1 } });
			if (!report) {
				return API.v1.failure('no-reports-found');
			}
		}

		const sanitizedReason: string = reason?.trim() ? reason : 'No reason provided';
		const action: string = actionParam ?? 'None';

		const { userId: moderatorId } = this;

		if (userId) {
			await ModerationReports.hideMessageReportsByUserId(userId, moderatorId, sanitizedReason, action);
		} else {
			await ModerationReports.hideMessageReportsByMessageId(msgId as string, moderatorId, sanitizedReason, action);
		}

		return API.v1.success({ success: true });
	},
);

API.v1.post(
	'moderation.dismissUserReports',
	{
		authRequired: true,
		permissionsRequired: ['manage-moderation-actions'],
		body: isArchiveReportProps,
		response: {
			200: successResponseSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
			403: validateForbiddenErrorResponse,
		},
	},
	async function action() {
		const { userId, reason, action: actionParam } = this.bodyParams;

		if (!userId) {
			return API.v1.failure('error-user-id-param-not-provided');
		}

		const sanitizedReason: string = reason ?? 'No reason provided';
		const action: string = actionParam ?? 'None';

		const { userId: moderatorId } = this;

		await ModerationReports.hideUserReportsByUserId(userId, moderatorId, sanitizedReason, action);

		return API.v1.success({ success: true });
	},
);

API.v1.get(
	'moderation.reports',
	{
		authRequired: true,
		permissionsRequired: ['view-moderation-console'],
		query: isReportsByMsgIdParams,
		response: {
			200: paginatedReportsResponseSchema,
			401: validateUnauthorizedErrorResponse,
			403: validateForbiddenErrorResponse,
		},
	},
	async function action() {
		const { msgId } = this.queryParams;

		const { count = 50, offset = 0 } = await getPaginationItems(this.queryParams);
		const { sort } = await this.parseJsonQuery();
		const { selector = '' } = this.queryParams;

		const escapedSelector = escapeRegExp(selector);

		const { cursor, totalCount } = ModerationReports.findReportsByMessageId(msgId, escapedSelector, { count, sort, offset });

		const [reports, total] = await Promise.all([cursor.toArray(), totalCount]);

		return API.v1.success({
			success: true,
			reports,
			count: reports.length,
			offset,
			total,
		});
	},
);

API.v1.get(
	'moderation.reportInfo',
	{
		authRequired: true,
		permissionsRequired: ['view-moderation-console'],
		query: isReportInfoParams,
		response: {
			200: reportInfoResponseSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
			403: validateForbiddenErrorResponse,
		},
	},
	async function action() {
		const { reportId } = this.queryParams;

		const report = await ModerationReports.findOneById(reportId);

		if (!report) {
			return API.v1.failure('error-report-not-found');
		}

		return API.v1.success({ success: true, report });
	},
);

API.v1.post(
	'moderation.reportUser',
	{
		authRequired: true,
		body: isModerationReportUserPost,
		response: {
			200: successResponseSchema,
			400: validateBadRequestErrorResponse,
			401: validateUnauthorizedErrorResponse,
		},
	},
	async function action() {
		const { userId, description } = this.bodyParams;

		const {
			user: { _id, name, username, createdAt },
		} = this;

		const reportedUser = await Users.findOneById(userId, {
			projection: { _id: 1, name: 1, username: 1, emails: 1, createdAt: 1 },
		});

		if (!reportedUser) {
			return API.v1.failure('Invalid user id provided.');
		}

		await ModerationReports.createWithDescriptionAndUser(reportedUser, description, { _id, name, username, createdAt });

		return API.v1.success({ success: true });
	},
);
