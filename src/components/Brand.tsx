export default function Brand({ href = '/' }: { href?: string }) {
  return (
    <a className="brand-link" href={href}>
      <img src="/icons/logo-64.png" width="28" height="28" alt="" />
      <span>LCT Collect</span>
    </a>
  );
}
