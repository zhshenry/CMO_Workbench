import { officeReplyTextSchema, type OfficeReplySource } from '../shared/office-workbench';
import { payloadHash } from './bot-store';

export function officeReplyAction(target: NonNullable<OfficeReplySource['target']>, draft: string) {
  const [kind, id] = target.conversation.split(':');
  const group = kind === 'group';
  const command = { service: 'im', subcommand: group ? 'send-to-group' : 'send-to-user',
    args: [group ? '--group-id' : '--receiver', id, '--text=' + officeReplyTextSchema.parse(draft)] };
  return { channel: 'welink', ...command, account: target.account, officeReply: true, intent: '在 WeLink 回复',
    target: target.recipient || id, fingerprint: payloadHash({ ...command, account: target.account }) };
}
