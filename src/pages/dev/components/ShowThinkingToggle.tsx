import { Switch, Label, Header } from "@/components";
import { useState, useEffect } from "react";
import { getResponseSettings, updateShowThinking } from "@/lib";

export const ShowThinkingToggle = () => {
  const [isEnabled, setIsEnabled] = useState<boolean>(true);

  useEffect(() => {
    const settings = getResponseSettings();
    setIsEnabled(settings.showThinking);
  }, []);

  const handleSwitchChange = (checked: boolean) => {
    setIsEnabled(checked);
    updateShowThinking(checked);
  };

  return (
    <div className="space-y-4">
      <Header
        title="Show Thinking"
        description="Control whether reasoning model thought processes (e.g., DeepSeek R1) are displayed in chat responses"
        isMainTitle
      />

      <div className="flex items-center justify-between p-4 border rounded-xl">
        <div className="flex items-center space-x-3">
          <div>
            <Label className="text-sm font-medium">
              {isEnabled ? "Thinking Visible" : "Thinking Hidden"}
            </Label>
            <p className="text-xs text-muted-foreground mt-1">
              {isEnabled
                ? "Reasoning model thought processes are shown as a styled section"
                : "Reasoning model thought processes are stripped from responses"}
            </p>
          </div>
        </div>
        <Switch
          checked={isEnabled}
          onCheckedChange={handleSwitchChange}
          title={`Toggle to ${isEnabled ? "hide" : "show"} thinking`}
          aria-label={`Toggle to ${isEnabled ? "hide" : "show"} thinking`}
        />
      </div>
    </div>
  );
};
