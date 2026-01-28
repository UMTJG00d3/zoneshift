import { DnsRecord } from '../utils/zoneParser';

interface RecordTableProps {
  records: DnsRecord[];
}

export default function RecordTable({ records }: RecordTableProps) {
  if (records.length === 0) {
    return <p className="muted">No records found.</p>;
  }

  return (
    <div className="table-container">
      <table className="record-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>TTL</th>
            <th>Type</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r, i) => (
            <tr key={i}>
              <td>{r.name}</td>
              <td>{r.ttl}</td>
              <td><span className={`badge badge-${r.type.toLowerCase()}`}>{r.type}</span></td>
              <td className="value-cell">{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
