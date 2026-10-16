import { APP_NAME, TAGLINE } from '@sutra/domain';

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-5xl font-semibold tracking-tight">{APP_NAME}</h1>
      <p className="text-lg text-neutral-500">{TAGLINE}</p>
    </main>
  );
}
