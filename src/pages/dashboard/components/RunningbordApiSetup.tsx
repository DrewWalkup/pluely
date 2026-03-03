import { Header } from "@/components";

export const RunningbordApiSetup = () => {
  return (
    <div id="runningbord-api" className="space-y-3 -mt-2">
      <div className="space-y-2 pt-2">
        <Header
          title={"Runningbord API (disabled)"}
          description={"Remote Runningbord API and license activation are disabled in this build. The app will use your configured local providers and settings instead."}
        />
        <div className="text-sm text-muted-foreground">
          If you had a previously configured Runningbord license or remote model selection, that configuration will not be used in this free build.
        </div>
      </div>
    </div>
  );
};


