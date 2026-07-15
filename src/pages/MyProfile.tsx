import { AppLayout } from "@/components/AppLayout";
import { MyProfileTab } from "@/components/settings/MyProfileTab";

export default function MyProfile() {
  return (
    <AppLayout title="My Profile">
      <div className="max-w-4xl mx-auto">
        <MyProfileTab />
      </div>
    </AppLayout>
  );
}
