export default function Home() {
  return (
    <div className="min-h-screen bg-[#10214F] text-[#F4F5F7]">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <span className="text-lg font-medium tracking-tight">zunia</span>
        <span className="font-mono text-xs text-[#6E80AE]">
          wallet.zuniawallet.com
        </span>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-24 text-center">
        <h1 className="text-4xl font-medium tracking-tight">Portfolio</h1>
        <p className="mt-4 text-[#A8BADE]">
          Connect your Zunia extension or mobile wallet to view balances and
          activity. Non-custodial. Keys never leave your device.
        </p>
        <button
          type="button"
          className="mt-8 rounded-full bg-[#2050C4] px-6 py-3 text-sm font-medium text-white"
        >
          Connect wallet
        </button>
      </main>
    </div>
  );
}
