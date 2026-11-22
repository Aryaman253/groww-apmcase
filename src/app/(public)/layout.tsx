export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="pt-safe mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-[max(env(safe-area-inset-bottom),1.5rem)]">
      {children}
    </main>
  );
}
