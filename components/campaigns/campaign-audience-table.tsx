import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface CampaignAudienceTableItem {
  id: string;
  creator: string;
  handle: string;
  product: string;
  matchScore: number;
  niche: string;
  recommended: boolean;
}

export function CampaignAudienceTable({ items }: { items: CampaignAudienceTableItem[] }) {
  if (!items.length) {
    return (
      <div className="p-10 text-center text-sm text-white/45">Nenhuma recomendação gerada.</div>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Creator</TableHead>
          <TableHead>Produto</TableHead>
          <TableHead>Match</TableHead>
          <TableHead>Nicho</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id}>
            <TableCell>
              <div className="font-medium text-white">{item.creator}</div>
              <div className="text-xs text-white/40">@{item.handle}</div>
            </TableCell>
            <TableCell>{item.product}</TableCell>
            <TableCell>
              <span className="font-semibold text-brand-300">{item.matchScore}</span>
              <span className="text-white/35">/100</span>
            </TableCell>
            <TableCell>{item.niche}</TableCell>
            <TableCell>
              <Badge tone={item.recommended ? "success" : "neutral"}>
                {item.recommended ? "Recomendado" : "Revisão"}
              </Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
