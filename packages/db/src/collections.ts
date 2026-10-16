import {
  adkEvent,
  adkSession,
  auditEvent,
  businessProfileDoc,
  campaign,
  chatMessage,
  company,
  consent,
  contact,
  credential,
  enrollment,
  icpDoc,
  llmUsage,
  meeting,
  message,
  pipelineNode,
  pipelineRun,
  placesUsage,
  reply,
  suppression,
  trackingEvent,
  workspaceSettings,
} from '@sutra/domain';
import { repository } from './repository.ts';

export const WorkspaceSettings = repository('workspace_settings', workspaceSettings);
export const BusinessProfiles = repository('business_profiles', businessProfileDoc);
export const Icps = repository('icps', icpDoc);
export const Companies = repository('companies', company);
export const Contacts = repository('contacts', contact);
export const Campaigns = repository('campaigns', campaign);
export const Enrollments = repository('enrollments', enrollment);
export const Messages = repository('messages', message);
export const TrackingEvents = repository('tracking_events', trackingEvent);
export const Replies = repository('replies', reply);
export const Meetings = repository('meetings', meeting);
export const Suppressions = repository('suppressions', suppression);
export const Consents = repository('consents', consent);
export const PipelineRuns = repository('pipeline_runs', pipelineRun);
export const PipelineNodes = repository('pipeline_nodes', pipelineNode);
export const ChatMessages = repository('chat_messages', chatMessage);
export const Credentials = repository('credentials', credential);
export const AuditEvents = repository('audit_events', auditEvent);
export const LlmUsage = repository('llm_usage', llmUsage);
export const PlacesUsage = repository('places_usage', placesUsage);
export const AdkSessions = repository('adk_sessions', adkSession);
export const AdkEvents = repository('adk_events', adkEvent);

/** Every collection Sutra owns (Better Auth manages its own). */
export const repositories = [
  WorkspaceSettings,
  BusinessProfiles,
  Icps,
  Companies,
  Contacts,
  Campaigns,
  Enrollments,
  Messages,
  TrackingEvents,
  Replies,
  Meetings,
  Suppressions,
  Consents,
  PipelineRuns,
  PipelineNodes,
  ChatMessages,
  Credentials,
  AuditEvents,
  LlmUsage,
  PlacesUsage,
  AdkSessions,
  AdkEvents,
] as const;

export type CollectionName = (typeof repositories)[number]['name'];
