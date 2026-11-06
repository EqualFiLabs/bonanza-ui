"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="empty notlive" role="alert">
      <h1 className="disp">Signal lost</h1>
      <p>Something went wrong loading this screen.</p>
      <button type="button" className="btn" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
