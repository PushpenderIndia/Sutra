import { WebsiteForm } from './website-form';

export default function OnboardingPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-semibold tracking-tight">What's your company website?</h1>
      <WebsiteForm />
    </main>
  );
}
