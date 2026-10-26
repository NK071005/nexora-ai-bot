import { useNavigate } from "react-router-dom";
import { Compass, Home } from "lucide-react";
import { useDocumentTitle } from "@/hooks/useApi";
import { Button, EmptyState } from "@/components/ui/primitives";

export function NotFoundPage() {
  useDocumentTitle("Page not found");
  const navigate = useNavigate();
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <EmptyState
        icon={Compass}
        title="This page does not exist"
        description="The link may be outdated, or the page may belong to a different workspace."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button icon={Home} onClick={() => navigate("/")}>
              Back to home
            </Button>
            <Button variant="secondary" onClick={() => navigate("/chat")}>
              Open conversations
            </Button>
          </div>
        }
        className="w-full max-w-xl border-solid bg-white py-14 dark:bg-white/[0.02]"
      />
    </div>
  );
}
