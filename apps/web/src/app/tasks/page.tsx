import { Suspense } from 'react';
import { ListView } from '@/components/list-view';

export default function TasksPage() {
  return (
    <Suspense fallback={null}>
      <ListView />
    </Suspense>
  );
}
