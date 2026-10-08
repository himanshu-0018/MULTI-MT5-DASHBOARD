//+------------------------------------------------------------------+
//|                                     MT5_Dashboard_Streamer.mq5   |
//|                                  Multi-Account Cloud Synchronizer|
//+------------------------------------------------------------------+
#property copyright "MT5 Dashboard"
#property link      "https://multi-mt5-dashboard-production.up.railway.app"
#property version   "1.10"
#property strict

//--- INPUT PARAMETERS ---
input group "=== SERVER CONFIGURATION ==="
input string   InpServerUrl       = "https://multi-mt5-dashboard-production.up.railway.app/api/ea/sync"; // Sync Endpoint URL
input int      InpSyncInterval    = 5;                                      // Sync Interval (seconds)
input int      InpHistoryDays     = 30;                                     // History Days to Sync (e.g. 30)

input group "=== CUSTOM ACCOUNT LABELS ==="
input string   InpCustomAccName   = "";                                     // Optional Nickname (e.g. "Funded $100k")

//--- GLOBAL VARIABLES ---
datetime lastSyncTime = 0;
string   lastSyncStatus = "Starting...";

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
{
   // Set timer for periodic sync
   EventSetTimer(InpSyncInterval);
   
   Print("🚀 MT5 Dashboard Streamer v1.10 Initialized.");
   Print("📡 Target Server: ", InpServerUrl);
   
   // Run immediate initial sync
   SyncDataToServer();
   
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                                 |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
   Comment("");
   
   // Send disconnect signal to remove account data immediately
   SendDisconnect();
   
   Print("🛑 MT5 Dashboard Streamer Stopped.");
}

//+------------------------------------------------------------------+
//| Timer event function                                             |
//+------------------------------------------------------------------+
void OnTimer()
{
   SyncDataToServer();
}

//+------------------------------------------------------------------+
//| Main function to collect and send data                           |
//+------------------------------------------------------------------+
void SyncDataToServer()
{
   // 1. Build Account JSON Object
   string accJson = GetAccountJson();
   
   // 2. Build Open Positions JSON Array
   string positionsJson = GetOpenPositionsJson();
   
   // 3. Build Pending Orders JSON Array (NEW)
   string pendingJson = GetPendingOrdersJson();
   
   // 4. Build Closed Trades History JSON Array
   string tradesJson = GetClosedTradesJson(InpHistoryDays);
   
   // Combine into master payload
   string payload = "{\n" +
                    "  \"account\": " + accJson + ",\n" +
                    "  \"open_positions\": " + positionsJson + ",\n" +
                    "  \"pending_orders\": " + pendingJson + ",\n" +
                    "  \"recent_trades\": " + tradesJson + "\n" +
                    "}";
                    
   // 5. Send via HTTP WebRequest
   SendPayload(payload);
   
   // 6. Update On-Chart Status Display
   UpdateChartComment();
}

//+------------------------------------------------------------------+
//| Collect Account Info                                             |
//+------------------------------------------------------------------+
string GetAccountJson()
{
   long   login       = AccountInfoInteger(ACCOUNT_LOGIN);
   string name        = (InpCustomAccName != "") ? InpCustomAccName : AccountInfoString(ACCOUNT_NAME);
   string broker      = AccountInfoString(ACCOUNT_COMPANY);
   string server      = AccountInfoString(ACCOUNT_SERVER);
   string currency    = AccountInfoString(ACCOUNT_CURRENCY);
   long   leverage    = AccountInfoInteger(ACCOUNT_LEVERAGE);
   double balance     = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity      = AccountInfoDouble(ACCOUNT_EQUITY);
   double margin      = AccountInfoDouble(ACCOUNT_MARGIN);
   double freeMargin  = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   double marginLevel = AccountInfoDouble(ACCOUNT_MARGIN_LEVEL);
   
   string json = StringFormat(
      "{\"account_number\":\"%I64d\",\"account_name\":\"%s\",\"broker\":\"%s\",\"server_name\":\"%s\",\"currency\":\"%s\",\"leverage\":\"1:%d\",\"balance\":%.2f,\"equity\":%.2f,\"margin\":%.2f,\"free_margin\":%.2f,\"margin_level\":%.2f}",
      login, EscapeJson(name), EscapeJson(broker), EscapeJson(server), currency, leverage, balance, equity, margin, freeMargin, marginLevel
   );
   
   return json;
}

//+------------------------------------------------------------------+
//| Collect Live Open Positions                                      |
//+------------------------------------------------------------------+
string GetOpenPositionsJson()
{
   string json = "[";
   int total = PositionsTotal();
   int count = 0;
   
   for(int i = 0; i < total; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket <= 0) continue;
      
      long   magic        = PositionGetInteger(POSITION_MAGIC);
      string symbol       = PositionGetString(POSITION_SYMBOL);
      long   typeEnum     = PositionGetInteger(POSITION_TYPE);
      string typeStr      = (typeEnum == POSITION_TYPE_BUY) ? "BUY" : "SELL";
      double volume       = PositionGetDouble(POSITION_VOLUME);
      double openPrice    = PositionGetDouble(POSITION_PRICE_OPEN);
      double currentPrice = PositionGetDouble(POSITION_PRICE_CURRENT);
      datetime openTime   = (datetime)PositionGetInteger(POSITION_TIME);
      double profit       = PositionGetDouble(POSITION_PROFIT);
      double swap         = PositionGetDouble(POSITION_SWAP);
      string comment      = PositionGetString(POSITION_COMMENT);
      
      string posObj = StringFormat(
         "{\"ticket\":\"%I64u\",\"magic_number\":%I64d,\"symbol\":\"%s\",\"trade_type\":\"%s\",\"volume\":%.2f,\"open_price\":%.5f,\"current_price\":%.5f,\"open_time\":\"%s\",\"profit\":%.2f,\"swap\":%.2f,\"comment\":\"%s\"}",
         ticket, magic, symbol, typeStr, volume, openPrice, currentPrice, TimeToString(openTime, TIME_DATE|TIME_SECONDS), profit, swap, EscapeJson(comment)
      );
      
      if(count > 0) json += ",";
      json += posObj;
      count++;
   }
   
   json += "]";
   return json;
}

//+------------------------------------------------------------------+
//| Collect Live Pending Orders (Limit & Stop Orders)                |
//+------------------------------------------------------------------+
string GetPendingOrdersJson()
{
   string json = "[";
   int total = OrdersTotal();
   int count = 0;
   
   for(int i = 0; i < total; i++)
   {
      ulong ticket = OrderGetTicket(i);
      if(ticket <= 0) continue;
      
      long   magic        = OrderGetInteger(ORDER_MAGIC);
      string symbol       = OrderGetString(ORDER_SYMBOL);
      ENUM_ORDER_TYPE typeEnum = (ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE);
      
      string typeStr = "PENDING";
      switch(typeEnum)
      {
         case ORDER_TYPE_BUY_LIMIT:       typeStr = "BUY_LIMIT"; break;
         case ORDER_TYPE_SELL_LIMIT:      typeStr = "SELL_LIMIT"; break;
         case ORDER_TYPE_BUY_STOP:        typeStr = "BUY_STOP"; break;
         case ORDER_TYPE_SELL_STOP:       typeStr = "SELL_STOP"; break;
         case ORDER_TYPE_BUY_STOP_LIMIT:  typeStr = "BUY_STOP_LIMIT"; break;
         case ORDER_TYPE_SELL_STOP_LIMIT: typeStr = "SELL_STOP_LIMIT"; break;
         default: continue; // skip non-pending order types
      }
      
      double volume       = OrderGetDouble(ORDER_VOLUME_CURRENT);
      double priceOpen    = OrderGetDouble(ORDER_PRICE_OPEN);
      double priceCurrent = OrderGetDouble(ORDER_PRICE_CURRENT);
      double sl           = OrderGetDouble(ORDER_SL);
      double tp           = OrderGetDouble(ORDER_TP);
      datetime setupTime  = (datetime)OrderGetInteger(ORDER_TIME_SETUP);
      datetime expTime    = (datetime)OrderGetInteger(ORDER_TIME_EXPIRATION);
      string comment      = OrderGetString(ORDER_COMMENT);
      
      string expStr = (expTime > 0) ? TimeToString(expTime, TIME_DATE|TIME_SECONDS) : "";
      
      string ordObj = StringFormat(
         "{\"ticket\":\"%I64u\",\"magic_number\":%I64d,\"symbol\":\"%s\",\"order_type\":\"%s\",\"volume\":%.2f,\"price_open\":%.5f,\"price_current\":%.5f,\"sl\":%.5f,\"tp\":%.5f,\"setup_time\":\"%s\",\"expiration\":\"%s\",\"comment\":\"%s\"}",
         ticket, magic, symbol, typeStr, volume, priceOpen, priceCurrent, sl, tp, TimeToString(setupTime, TIME_DATE|TIME_SECONDS), expStr, EscapeJson(comment)
      );
      
      if(count > 0) json += ",";
      json += ordObj;
      count++;
   }
   
   json += "]";
   return json;
}

//+------------------------------------------------------------------+
//| Collect Closed Trades from History                               |
//+------------------------------------------------------------------+
string GetClosedTradesJson(int daysBack)
{
   datetime fromDate = TimeCurrent() - (daysBack * 86400);
   datetime toDate   = TimeCurrent();
   
   if(!HistorySelect(fromDate, toDate))
   {
      return "[]";
   }
   
   string json = "[";
   int totalDeals = HistoryDealsTotal();
   int count = 0;
   
   for(int i = 0; i < totalDeals; i++)
   {
      ulong dealTicket = HistoryDealGetTicket(i);
      if(dealTicket <= 0) continue;
      
      // Only capture exit deals (closed trades)
      ENUM_DEAL_ENTRY entryType = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(dealTicket, DEAL_ENTRY);
      if(entryType != DEAL_ENTRY_OUT && entryType != DEAL_ENTRY_INOUT && entryType != DEAL_ENTRY_OUT_BY)
         continue;
         
      long   magic      = HistoryDealGetInteger(dealTicket, DEAL_MAGIC);
      string symbol     = HistoryDealGetString(dealTicket, DEAL_SYMBOL);
      long   typeEnum   = HistoryDealGetInteger(dealTicket, DEAL_TYPE);
      
      // Match trade type
      string typeStr    = (typeEnum == DEAL_TYPE_BUY) ? "BUY" : "SELL";
      
      double volume     = HistoryDealGetDouble(dealTicket, DEAL_VOLUME);
      double closePrice = HistoryDealGetDouble(dealTicket, DEAL_PRICE);
      datetime closeTime= (datetime)HistoryDealGetInteger(dealTicket, DEAL_TIME);
      double profit     = HistoryDealGetDouble(dealTicket, DEAL_PROFIT);
      double commission = HistoryDealGetDouble(dealTicket, DEAL_COMMISSION);
      double swap       = HistoryDealGetDouble(dealTicket, DEAL_SWAP);
      string comment    = HistoryDealGetString(dealTicket, DEAL_COMMENT);
      
      double netProfit  = profit + commission + swap;
      
      string tradeObj = StringFormat(
         "{\"ticket\":\"%I64u\",\"magic_number\":%I64d,\"symbol\":\"%s\",\"trade_type\":\"%s\",\"volume\":%.2f,\"open_price\":0,\"close_price\":%.5f,\"open_time\":\"%s\",\"close_time\":\"%s\",\"profit\":%.2f,\"commission\":%.2f,\"swap\":%.2f,\"net_profit\":%.2f,\"comment\":\"%s\"}",
         dealTicket, magic, symbol, typeStr, volume, closePrice, TimeToString(closeTime, TIME_DATE|TIME_SECONDS), TimeToString(closeTime, TIME_DATE|TIME_SECONDS), profit, commission, swap, netProfit, EscapeJson(comment)
      );
      
      if(count > 0) json += ",";
      json += tradeObj;
      count++;
   }
   
   json += "]";
   return json;
}

//+------------------------------------------------------------------+
//| HTTP WebRequest Sender                                           |
//+------------------------------------------------------------------+
void SendPayload(string jsonPayload)
{
   char postData[];
   char resultData[];
   string resultHeaders;
   string headers = "Content-Type: application/json\r\n";
   
   StringToCharArray(jsonPayload, postData, 0, WHOLE_ARRAY, CP_UTF8);
   int dataSize = ArraySize(postData) - 1;
   if(dataSize <= 0) return;
   ArrayResize(postData, dataSize);
   
   int res = WebRequest("POST", InpServerUrl, headers, 3000, postData, resultData, resultHeaders);
   
   lastSyncTime = TimeCurrent();
   
   if(res == 200)
   {
      lastSyncStatus = "200 OK (Synced)";
   }
   else if(res == -1)
   {
      int err = GetLastError();
      lastSyncStatus = StringFormat("Error %d (Check WebRequest URL in Options)", err);
      Print("❌ WebRequest Failed. Error Code: ", err);
   }
   else
   {
      lastSyncStatus = StringFormat("HTTP Status %d", res);
   }
}

//+------------------------------------------------------------------+
//| Send Disconnect Signal on EA Removal                             |
//+------------------------------------------------------------------+
void SendDisconnect()
{
   long login = AccountInfoInteger(ACCOUNT_LOGIN);
   string payload = StringFormat("{\"account_number\":\"%I64d\"}", login);
   
   char postData[];
   char resultData[];
   string resultHeaders;
   string headers = "Content-Type: application/json\r\n";
   
   StringToCharArray(payload, postData, 0, WHOLE_ARRAY, CP_UTF8);
   int dataSize = ArraySize(postData) - 1;
   if(dataSize <= 0) return;
   ArrayResize(postData, dataSize);
   
   string disconnectUrl = InpServerUrl;
   StringReplace(disconnectUrl, "/api/ea/sync", "/api/ea/disconnect");
   
   WebRequest("POST", disconnectUrl, headers, 1500, postData, resultData, resultHeaders);
}

//+------------------------------------------------------------------+
//| Escape Special Characters for JSON                               |
//+------------------------------------------------------------------+
string EscapeJson(string str)
{
   StringReplace(str, "\\", "\\\\");
   StringReplace(str, "\"", "\\\"");
   StringReplace(str, "\r", "");
   StringReplace(str, "\n", " ");
   return str;
}

//+------------------------------------------------------------------+
//| Visual On-Chart Information Display                              |
//+------------------------------------------------------------------+
void UpdateChartComment()
{
   string text = "\n" +
      "  ==========================================\n" +
      "  📊 MT5 DASHBOARD STREAMER (v1.10)\n" +
      "  ==========================================\n" +
      "  📡 Status       : " + lastSyncStatus + "\n" +
      "  ⏰ Last Sync    : " + TimeToString(lastSyncTime, TIME_SECONDS) + "\n" +
      "  ⚡ Interval     : Every " + IntegerToString(InpSyncInterval) + " sec\n" +
      "  💼 Account #    : " + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + " (" + AccountInfoString(ACCOUNT_CURRENCY) + ")\n" +
      "  💰 Balance      : " + DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE), 2) + "\n" +
      "  📈 Open Trades  : " + IntegerToString(PositionsTotal()) + "\n" +
      "  ⏳ Pending Orders: " + IntegerToString(OrdersTotal()) + "\n" +
      "  ==========================================\n";
      
   Comment(text);
}
//+------------------------------------------------------------------+
