import Link from "next/link";

export default function NotFound() {
  return (
    <div className="empty notlive">
      <h1 className="disp">Dead air</h1>
      <p>There&apos;s nothing on this channel.</p>
      <Link className="btn" href="/">
        Back to rounds
      </Link>
    </div>
  );
}
