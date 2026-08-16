import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/AppLayout";
import { MyProfileTab } from "@/components/settings/MyProfileTab";

export default function MyProfile() {
  const { t } = useTranslation();
  return (
    <AppLayout title={t("profile.title")}>
      <div className="max-w-4xl mx-auto">
        <MyProfileTab />
      </div>
    </AppLayout>
  );
}
