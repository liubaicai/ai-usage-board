package api

type UsageResponse struct {
	APIVersion  string    `json:"apiVersion"`
	GeneratedAt string    `json:"generatedAt"`
	Settings    Settings  `json:"settings"`
	Summary     Summary   `json:"summary"`
	Accounts    []Account `json:"accounts"`
}

type Settings struct {
	GlobalRefreshSec int `json:"globalRefreshSec"`
}

type Summary struct {
	Total             int                `json:"total"`
	OK                int                `json:"ok"`
	Warn              int                `json:"warn"`
	Error             int                `json:"error"`
	BalanceByCurrency map[string]float64 `json:"balanceByCurrency"`
}

type Account struct {
	ID                    string        `json:"id"`
	VendorID              string        `json:"vendorId"`
	VendorName            string        `json:"vendorName"`
	Vendor                string        `json:"vendor"`
	Kind                  string        `json:"kind"`
	Label                 string        `json:"label"`
	AccountName           string        `json:"accountName"`
	Plan                  string        `json:"plan"`
	SubscriptionExpiresAt string        `json:"subscriptionExpiresAt"`
	Status                string        `json:"status"`
	Windows               []QuotaWindow `json:"windows"`
	Balance               *Balance      `json:"balance"`
	Note                  string        `json:"note"`
	RefreshSec            *int          `json:"refreshSec"`
	LastFetched           int64         `json:"lastFetched"`
	UpdatedAt             string        `json:"updatedAt"`
}

type QuotaWindow struct {
	ID          string  `json:"id"`
	Label       string  `json:"label"`
	UsedPercent float64 `json:"usedPercent"`
	Available   *bool   `json:"available"`
	ResetIn     string  `json:"resetIn"`
	Detail      string  `json:"detail"`
	Value       string  `json:"value"`
	Group       string  `json:"group"`
}

type Balance struct {
	Amount       float64  `json:"amount"`
	Currency     string   `json:"currency"`
	Granted      *float64 `json:"granted"`
	TotalBalance *float64 `json:"totalBalance"`
}
