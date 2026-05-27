/**
 * @synap-core/chat-ui — Eve vendored subset
 *
 * Only the components used by Eve's companion are exported here.
 * The full package (MessageBubble, CompanionInput, etc.) requires
 * @synap-core/types and a matching lucide-react version not available
 * in this workspace. Add them back when those deps are available.
 */

export { CompanionLayout } from './components/CompanionLayout';
export type { CompanionLayoutProps, CompanionMessage } from './components/CompanionLayout';

export { StreamDots } from './components/StreamDots';
export type { StreamDotsProps } from './components/StreamDots';
