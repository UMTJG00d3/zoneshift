import { AzureFunction, Context, HttpRequest } from "@azure/functions";

const health: AzureFunction = async function (
  context: Context,
  _req: HttpRequest
): Promise<void> {
  context.res = {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: { status: "ok", timestamp: new Date().toISOString() },
  };
};

export default health;
