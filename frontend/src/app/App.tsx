import { Navigate, Route, Routes } from "react-router-dom";
import { AuthLayout } from "./AuthLayout";
import { AppShell } from "./AppShell";
import { AdminOnly, InternOnly, ProtectedRoute, SuperAdminOnly } from "./guards";
import { DashboardPage } from "@/pages/DashboardPage";
import { ChatPage } from "@/pages/ChatPage";
import { LibraryPage } from "@/pages/LibraryPage";
import { SearchPage } from "@/pages/SearchPage";
import { ScheduledPage } from "@/pages/ScheduledPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { AdminPage } from "@/pages/AdminPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { LoginPage } from "@/pages/auth/LoginPage";
import { RegisterPage } from "@/pages/auth/RegisterPage";
import { ForgotPasswordPage } from "@/pages/auth/ForgotPasswordPage";
import { ResetPasswordPage } from "@/pages/auth/ResetPasswordPage";
import { VerifyEmailPage } from "@/pages/auth/VerifyEmailPage";
import { ActivatePage } from "@/pages/auth/ActivatePage";
import { InternFlowOverviewPage } from "@/pages/internflow/OverviewPage";
import { InternsPage } from "@/pages/internflow/InternsPage";
import { InternDetailPage } from "@/pages/internflow/InternDetailPage";
import { TemplatesPage } from "@/pages/internflow/TemplatesPage";
import { ImportsPage } from "@/pages/internflow/ImportsPage";
import { EvaluationsPage } from "@/pages/internflow/EvaluationsPage";
import { MeetingsPage } from "@/pages/internflow/MeetingsPage";
import { OperationsPage } from "@/pages/internflow/OperationsPage";
import { MyWorkPage } from "@/pages/internflow/MyWorkPage";

export default function App() {
  return (
    <Routes>
      <Route element={<AuthLayout />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/activate" element={<ActivatePage />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/chat/:chatId" element={<ChatPage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/scheduled" element={<ScheduledPage />} />
          <Route path="/settings" element={<SettingsPage />} />

          <Route
            path="/internflow"
            element={
              <AdminOnly>
                <InternFlowOverviewPage />
              </AdminOnly>
            }
          />
          <Route
            path="/internflow/interns"
            element={
              <AdminOnly>
                <InternsPage />
              </AdminOnly>
            }
          />
          <Route
            path="/internflow/interns/:internId"
            element={
              <AdminOnly>
                <InternDetailPage />
              </AdminOnly>
            }
          />
          <Route
            path="/internflow/templates"
            element={
              <AdminOnly>
                <TemplatesPage />
              </AdminOnly>
            }
          />
          <Route
            path="/internflow/imports"
            element={
              <AdminOnly>
                <ImportsPage />
              </AdminOnly>
            }
          />
          <Route
            path="/internflow/evaluations"
            element={
              <AdminOnly>
                <EvaluationsPage />
              </AdminOnly>
            }
          />
          <Route
            path="/internflow/meetings"
            element={
              <AdminOnly>
                <MeetingsPage />
              </AdminOnly>
            }
          />
          <Route
            path="/internflow/operations"
            element={
              <AdminOnly>
                <OperationsPage />
              </AdminOnly>
            }
          />
          <Route
            path="/internflow/me"
            element={
              <InternOnly>
                <MyWorkPage />
              </InternOnly>
            }
          />
          <Route
            path="/admin"
            element={
              <SuperAdminOnly>
                <AdminPage />
              </SuperAdminOnly>
            }
          />

          <Route path="/chat/new" element={<Navigate to="/chat?new=1" replace />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
