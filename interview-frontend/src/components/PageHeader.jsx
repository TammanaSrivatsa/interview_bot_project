export default function PageHeader({ title, subtitle, actions }) {
  return (
    <header className="page-header">
      <div className="page-header-copy">
        <h2>{title}</h2>
        {subtitle ? <p className="page-lead">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-header-actions">{actions}</div> : null}
    </header>
  );
}
