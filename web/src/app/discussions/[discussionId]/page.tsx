import { MvpGate } from '@/components/mvp/MvpGate';
import { MvpRoom } from '@/components/mvp/MvpRoom';
export default async function Room({ params }: { params: Promise<{ discussionId: string }> }) { const { discussionId } = await params; return <MvpGate><MvpRoom id={discussionId} /></MvpGate>; }
