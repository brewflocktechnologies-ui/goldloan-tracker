const SPREADSHEET_ID =
  SpreadsheetApp.getActiveSpreadsheet().getId();
const SHEET_HEADERS = {
  Admins: ["AdminId", "Username", "Password", "Role", "Status"], // NEW: Admin Sheet
  Users: ["UserId", "CustomerCode", "FullName", "FatherHusbandName", "MobileNumber", "AlternateMobileNumber", "Email", "DateOfBirth", "Gender", "AadhaarNumber", "PANNumber", "AddressLine1", "AddressLine2", "City", "State", "Pincode", "Occupation", "CustomerPhoto", "Status", "CreatedDate", "UpdatedDate"],
  BankAccounts: ["BankAccountId", "UserId", "AccountHolderName", "AccountNumber", "BankName", "BranchName", "IFSCCode", "AccountType", "UPI_ID", "PassbookImage", "Status", "CreatedDate", "UpdatedDate", "MaxLoanAmount", "UtilizedLoanAmount"],
  Ornaments: ["OrnamentId", "UserId", "OrnamentName", "OrnamentType", "OrnamentCategory", "Description", "GrossWeight", "NetWeight", "StoneWeight", "Purity", "HallmarkNumber", "Quantity", "EstimatedValue", "MarketValue", "OrnamentImages", "Remarks", "Status", "ReleaseDate", "ReleasedLoanId"],
  Loans: ["LoanId", "LoanNumber", "UserId", "BankAccountId", "BankName", "LoanDate", "LoanAmount", "InterestRate", "InterestType", "LoanPeriod", "ProcessingFee", "DocumentCharge", "InsuranceCharge", "TotalCharges", "NetDisbursementAmount", "DueDate", "LoanStatus", "Remarks", "CreatedDate", "UpdatedDate", "ClosedDate", "ClosureRemarks"],
  LoanOrnaments: ["MappingId", "LoanId", "OrnamentId", "Status"],
  Payments: ["PaymentId", "LoanId", "PaymentDate", "PaymentType", "PrincipalAmount", "InterestAmount", "PenaltyAmount", "TotalPaidAmount", "PaymentMethod", "TransactionReference", "Remarks", "CreatedDate"],
  Releases: ["ReleaseId", "LoanId", "OrnamentId", "ReleaseDate", "ReleasedBy", "CustomerSignature", "DeliveryProofImage", "Remarks"]
};

// ─── SETUP ───

function setupSheets() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    Object.entries(SHEET_HEADERS).forEach(([name, headers]) => {
      let sheet = ss.getSheetByName(name);
      if (!sheet) {
        sheet = ss.insertSheet(name);
      }

      const lastCol = sheet.getLastColumn();
      if (lastCol === 0) {
        const firstRowRange = sheet.getRange(1, 1, 1, headers.length);
        firstRowRange.setValues([headers]);
        firstRowRange.setFontWeight("bold").setBackground("#4a90e2").setFontColor("#ffffff");
        sheet.setFrozenRows(1);

        // NEW: Seed default admin credentials if setting up for the first time
        if (name === "Admins") {
          // Default Username: admin, Password: password123
          sheet.appendRow(["ADM001", "admin", "password123", "SuperAdmin", "Active"]);
        }
      } else {
        const firstRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
        const headersMatch = headers.length === firstRow.length && firstRow.every((val, i) => val === headers[i]);
        if (!headersMatch) {
          if (sheet.getLastRow() <= 1) {
            sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
            sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#4a90e2").setFontColor("#ffffff");
            sheet.setFrozenRows(1);
          } else {
            headers.forEach(h => {
              if (!firstRow.includes(h)) {
                const newCol = sheet.getLastColumn() + 1;
                const cell = sheet.getRange(1, newCol);
                cell.setValue(h);
                cell.setFontWeight("bold").setBackground("#4a90e2").setFontColor("#ffffff");
                firstRow.push(h);

                if (name === "Loans" && h === "BankName") {
                  try {
                    const bankAccounts = getSheetData("BankAccounts");
                    const bankMap = new Map(bankAccounts.map(b => [String(b.BankAccountId), b.BankName]));
                    const data = sheet.getDataRange().getValues();
                    const bankAccIdx = data[0].indexOf("BankAccountId");
                    if (bankAccIdx !== -1) {
                      for (let r = 1; r < data.length; r++) {
                        const accId = String(data[r][bankAccIdx]);
                        if (accId && bankMap.has(accId)) {
                          sheet.getRange(r + 1, newCol).setValue(bankMap.get(accId));
                        }
                      }
                    }
                  } catch (err) {
                    console.error("Error backfilling BankName:", err);
                  }
                }
              }
            });
          }
        }
      }
    });

    // Reconcile all bank account utilization on setup
    try {
      const allBankAccounts = getSheetData("BankAccounts");
      const activeLoans = getSheetData("Loans").filter(l => l.LoanStatus === "Active");
      allBankAccounts.forEach(acc => {
        const exactUtilized = activeLoans
          .filter(l => String(l.UserId) === String(acc.UserId) && String(l.BankAccountId) === String(acc.BankAccountId))
          .reduce((sum, l) => sum + (parseFloat(l.LoanAmount) || 0), 0);
        if (parseFloat(acc.UtilizedLoanAmount) !== exactUtilized) {
          updateRow("BankAccounts", "BankAccountId", acc.BankAccountId, { UtilizedLoanAmount: exactUtilized });
        }
      });
    } catch (err) {
      console.error("Error reconciling bank accounts:", err);
    }

    return { success: true, data: "Sheets initialized successfully" };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ─── AUTHENTICATION ───

function authenticateAdmin(username, password) {
  try {
    const admins = getSheetData("Admins").filter(a => a.Status === "Active");
    const admin = admins.find(a => String(a.Username) === String(username) && String(a.Password) === String(password));

    if (admin) {
      return { success: true, data: { username: admin.Username, role: admin.Role } };
    } else {
      return { success: false, error: "Invalid username or password." };
    }
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile("index")
    .setTitle("Gold Loan Tracker")
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ─── GENERIC CRUD HELPERS ───

function getSheetData(sheetName) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  const headers = data[0];

  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      let cellValue = row[i];
      if (cellValue instanceof Date) {
        cellValue = cellValue.toISOString();
      }
      obj[h] = cellValue;
    });
    return obj;
  });
}

function appendRow(sheetName, rowObject) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return;
  const lastCol = sheet.getLastColumn();
  const headers = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : SHEET_HEADERS[sheetName];
  const row = headers.map(h => rowObject[h] !== undefined ? rowObject[h] : "");
  sheet.appendRow(row);
}

function updateRow(sheetName, idColumn, idValue, updatedObject) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return false;
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return false;
  const headers = data[0];
  const idColIndex = headers.indexOf(idColumn);
  if (idColIndex === -1) return false;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idColIndex]) === String(idValue)) {
      headers.forEach((h, j) => {
        if (updatedObject[h] !== undefined) {
          sheet.getRange(i + 1, j + 1).setValue(updatedObject[h]);
        }
      });
      return true;
    }
  }
  return false;
}

function deleteRow(sheetName, idColumn, idValue) {
  const statusMap = { Users: "Status", Ornaments: "Status", Loans: "LoanStatus", BankAccounts: "Status" };
  const statusCol = statusMap[sheetName] || "Status";
  return updateRow(sheetName, idColumn, idValue, { [statusCol]: "Deleted" });
}

function generateId(prefix, sheetName, idColumn) {
  const data = getSheetData(sheetName);
  if (data.length === 0) return prefix + "001";
  const nums = data
    .map(r => parseInt(String(r[idColumn]).replace(prefix, ""), 10))
    .filter(n => !isNaN(n));
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  return prefix + String(next).padStart(3, "0");
}

// ─── USER FUNCTIONS ───

function addUser(userData) {
  try {
    const userId = generateId("U", "Users", "UserId");
    const photoUrl = processDriveFiles(userData.files, "Customer_Photos")[0] || "";

    const record = {
      UserId: userId,
      CustomerCode: userData.CustomerCode || "",
      FullName: userData.FullName,
      FatherHusbandName: userData.FatherHusbandName || "",
      MobileNumber: userData.MobileNumber || "",
      AlternateMobileNumber: userData.AlternateMobileNumber || "",
      Email: userData.Email || "",
      DateOfBirth: userData.DateOfBirth || "",
      Gender: userData.Gender || "",
      AadhaarNumber: userData.AadhaarNumber || "",
      PANNumber: userData.PANNumber || "",
      AddressLine1: userData.AddressLine1 || "",
      AddressLine2: userData.AddressLine2 || "",
      City: userData.City || "",
      State: userData.State || "",
      Pincode: userData.Pincode || "",
      Occupation: userData.Occupation || "",
      CustomerPhoto: photoUrl,
      CreatedDate: new Date().toISOString(),
      Status: "Active"
    };
    appendRow("Users", record);
    return { success: true, data: record };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function getUsers() {
  try {
    const users = getSheetData("Users").filter(u => u.Status !== "Deleted");
    return { success: true, data: users };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function updateUser(userId, userData) {
  try {
    if (userData.files && userData.files.length > 0) {
      userData.CustomerPhoto = processDriveFiles(userData.files, "Customer_Photos")[0];
    }
    delete userData.files; // Don't write files array to sheet
    userData.UpdatedDate = new Date().toISOString();
    updateRow("Users", "UserId", userId, userData);
    return { success: true, data: "User updated" };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
function deleteUser(userId) {
  try {
    deleteRow("Users", "UserId", userId);
    return { success: true, data: "User deleted" };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ─── BANK ACCOUNT FUNCTIONS ───

function addBankAccount(accountData) {
  try {
    const accountId = generateId("BA", "BankAccounts", "BankAccountId");
    const passbookUrl = processDriveFiles(accountData.files, "Passbook_Images")[0] || "";

    const record = {
      BankAccountId: accountId,
      UserId: accountData.UserId,
      AccountHolderName: accountData.AccountHolderName,
      AccountNumber: accountData.AccountNumber,
      BankName: accountData.BankName,
      BranchName: accountData.BranchName || "",
      IFSCCode: accountData.IFSCCode || "",
      AccountType: accountData.AccountType || "",
      UPI_ID: accountData.UPI_ID || "",
      PassbookImage: passbookUrl,
      Status: "Active",
      CreatedDate: new Date().toISOString(),
      MaxLoanAmount: parseFloat(accountData.MaxLoanAmount) || 0,
      UtilizedLoanAmount: parseFloat(accountData.UtilizedLoanAmount) || 0
    };
    appendRow("BankAccounts", record);
    return { success: true, data: record };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function calculateUserBankUtilization(userId, bankAccountId, activeLoans) {
  const loans = activeLoans || getSheetData("Loans").filter(l => l.LoanStatus === "Active");
  return loans
    .filter(l => String(l.UserId) === String(userId) && String(l.BankAccountId) === String(bankAccountId))
    .reduce((sum, l) => sum + (parseFloat(l.LoanAmount) || 0), 0);
}

function recalculateAndSyncBankUtilization(bankAccountId) {
  if (!bankAccountId) return 0;
  const bankAccounts = getSheetData("BankAccounts");
  const acc = bankAccounts.find(b => String(b.BankAccountId) === String(bankAccountId));
  if (!acc) return 0;
  const utilized = calculateUserBankUtilization(acc.UserId, acc.BankAccountId);
  if (parseFloat(acc.UtilizedLoanAmount) !== utilized) {
    updateRow("BankAccounts", "BankAccountId", bankAccountId, { UtilizedLoanAmount: utilized });
  }
  return utilized;
}

function getBankAccounts(userId) {
  try {
    let accounts = getSheetData("BankAccounts").filter(acc => acc.Status !== "Deleted");
    if (userId) {
      accounts = accounts.filter(acc => String(acc.UserId) === String(userId));
    }

    const loans = getSheetData("Loans");
    const activeLoans = loans.filter(l => l.LoanStatus === "Active");

    const enriched = accounts.map(acc => {
      const maxLoan = parseFloat(acc.MaxLoanAmount) || 0;
      const utilized = calculateUserBankUtilization(acc.UserId, acc.BankAccountId, activeLoans);
      const available = Math.max(0, maxLoan - utilized);

      if (parseFloat(acc.UtilizedLoanAmount) !== utilized) {
        updateRow("BankAccounts", "BankAccountId", acc.BankAccountId, { UtilizedLoanAmount: utilized });
      }

      return {
        ...acc,
        MaxLoanAmount: maxLoan,
        UtilizedLoanAmount: utilized,
        AvailableLoanAmount: available
      };
    });

    return { success: true, data: enriched };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function updateBankAccount(accountId, accountData) {
  try {
    if (accountData.files && accountData.files.length > 0) {
      accountData.PassbookImage = processDriveFiles(accountData.files, "Passbook_Images")[0];
    }
    delete accountData.files;
    accountData.UpdatedDate = new Date().toISOString();
    updateRow("BankAccounts", "BankAccountId", accountId, accountData);
    recalculateAndSyncBankUtilization(accountId);
    return { success: true, data: "Bank account updated" };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function deleteBankAccount(accountId) {
  try {
    deleteRow("BankAccounts", "BankAccountId", accountId);
    return { success: true, data: "Bank account deleted" };
  } catch (e) {
    return { success: false, error: e.message };
  }
}


// ─── FILE & ORNAMENT FUNCTIONS ───

function processDriveFiles(files, folderName) {
  let imageUrls = [];
  if (files && files.length > 0) {
    const rootFolderName = "GoldLoanApp_Uploads";
    let rootFolder;
    const rootFolders = DriveApp.getFoldersByName(rootFolderName);
    if (rootFolders.hasNext()) {
      rootFolder = rootFolders.next();
    } else {
      rootFolder = DriveApp.createFolder(rootFolderName);
    }

    let folder;
    const folders = rootFolder.getFoldersByName(folderName);
    if (folders.hasNext()) {
      folder = folders.next();
    } else {
      folder = rootFolder.createFolder(folderName);
    }

    for (const file of files) {
      const blob = Utilities.newBlob(Utilities.base64Decode(file.base64), file.mimeType, file.name);
      const uploadedFile = folder.createFile(blob);
      uploadedFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      imageUrls.push(uploadedFile.getUrl());
    }
  }
  return imageUrls;
}

function addOrnament(ornamentData) {
  try {
    const ornamentId = generateId("ORN", "Ornaments", "OrnamentId");
    let imageUrls = processDriveFiles(ornamentData.files, "Ornament_Images");

    const record = {
      OrnamentId: ornamentId,
      UserId: ornamentData.UserId || "",
      OrnamentName: ornamentData.OrnamentName,
      OrnamentType: ornamentData.OrnamentType || "",
      OrnamentCategory: ornamentData.OrnamentCategory || "",
      Description: ornamentData.Description || "",
      GrossWeight: parseFloat(ornamentData.GrossWeight) || 0,
      NetWeight: parseFloat(ornamentData.NetWeight) || 0,
      StoneWeight: parseFloat(ornamentData.StoneWeight) || 0,
      Purity: ornamentData.Purity || "22K",
      HallmarkNumber: ornamentData.HallmarkNumber || "",
      Quantity: parseInt(ornamentData.Quantity) || 1,
      EstimatedValue: parseFloat(ornamentData.EstimatedValue) || 0,
      MarketValue: parseFloat(ornamentData.MarketValue) || 0,
      OrnamentImages: imageUrls.join(" | "),
      Status: "Available",
      Remarks: ornamentData.Remarks || ""
    };
    appendRow("Ornaments", record);
    return { success: true, data: record };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function updateOrnament(ornamentId, ornamentData) {
  try {
    let newImageUrls = processDriveFiles(ornamentData.files, "Ornament_Images");

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName("Ornaments");
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idColIndex = headers.indexOf("OrnamentId");
    const photoColIndex = headers.indexOf("OrnamentImages");

    let combinedUrls = "";
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idColIndex]) === String(ornamentId)) {
        let existingUrls = data[i][photoColIndex] ? String(data[i][photoColIndex]) : "";
        if (newImageUrls.length > 0) {
          combinedUrls = existingUrls ? [existingUrls, ...newImageUrls].join(" | ") : newImageUrls.join(" | ");
        } else {
          combinedUrls = existingUrls;
        }
        break;
      }
    }

    delete ornamentData.files;
    ornamentData.OrnamentImages = combinedUrls;

    updateRow("Ornaments", "OrnamentId", ornamentId, ornamentData);
    return { success: true, data: "Ornament updated" };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function deleteOrnamentImage(ornamentId, imageUrlToRemove) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName("Ornaments");
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idColIndex = headers.indexOf("OrnamentId");
    const photoColIndex = headers.indexOf("OrnamentImages");

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idColIndex]) === String(ornamentId)) {
        let currentUrls = data[i][photoColIndex] ? String(data[i][photoColIndex]).split(" | ") : [];
        let newUrls = currentUrls.filter(url => url.trim() !== imageUrlToRemove.trim());
        sheet.getRange(i + 1, photoColIndex + 1).setValue(newUrls.join(" | "));
        break;
      }
    }

    const fileIdMatch = imageUrlToRemove.match(/\/d\/(.+?)\//);
    if (fileIdMatch && fileIdMatch[1]) {
      DriveApp.getFileById(fileIdMatch[1]).setTrashed(true);
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.toString() };
  }
}

function deleteOrnament(ornamentId) {
  try {
    const success = deleteRow("Ornaments", "OrnamentId", ornamentId);
    if (success) {
      return { success: true, data: "Ornament deleted" };
    } else {
      return { success: false, error: `Ornament with ID ${ornamentId} not found.` };
    }
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function getOrnaments(userId) {
  try {
    let ornaments = getSheetData("Ornaments").filter(o => o.Status !== "Deleted");
    if (userId) ornaments = ornaments.filter(o => String(o.UserId) === String(userId));
    return { success: true, data: ornaments };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
function getAvailableOrnaments() {
  try {
    const ornaments = getSheetData("Ornaments").filter(o => o.Status === "Available" || o.Status === "Released");
    return { success: true, data: ornaments };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function updateOrnamentStatus(ornamentId, status) {
  try {
    updateRow("Ornaments", "OrnamentId", ornamentId, { Status: status });
    return { success: true, data: "Ornament status updated" };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ─── LOAN FUNCTIONS ───

function addLoan(loanData) {
  try {
    const existing = getSheetData("Loans").find(l =>
      String(l.LoanNumber) === String(loanData.LoanNumber) && l.LoanStatus !== "Cancelled"
    );
    if (existing) return { success: false, error: "Loan number already exists" };

    const bankAccounts = getSheetData("BankAccounts");
    const bankAccount = bankAccounts.find(acc => String(acc.BankAccountId) === String(loanData.BankAccountId));
    if (!bankAccount) return { success: false, error: "Selected bank account not found" };

    if (String(bankAccount.UserId) !== String(loanData.UserId)) {
      return { success: false, error: "Selected bank account does not belong to this user" };
    }

    const loanAmount = parseFloat(loanData.LoanAmount) || 0;
    if (loanAmount <= 0) return { success: false, error: "Loan amount must be greater than 0" };

    const maxLoan = parseFloat(bankAccount.MaxLoanAmount) || 0;
    const currentUtilized = calculateUserBankUtilization(loanData.UserId, loanData.BankAccountId);
    const availableAmount = Math.max(0, maxLoan - currentUtilized);

    if (maxLoan > 0 && loanAmount > availableAmount) {
      return {
        success: false,
        error: `Loan amount of ₹${loanAmount} exceeds the available limit of ₹${availableAmount} for ${bankAccount.BankName} (Account ${bankAccount.AccountNumber}). Max Limit: ₹${maxLoan}, Current Utilized: ₹${currentUtilized}`
      };
    }

    const bankName = bankAccount.BankName || (loanData.BankName || "");
    const loanId = generateId("L", "Loans", "LoanId");
    const record = {
      LoanId: loanId,
      LoanNumber: loanData.LoanNumber,
      UserId: loanData.UserId || "",
      BankAccountId: loanData.BankAccountId || "",
      BankName: bankName,
      LoanDate: loanData.LoanDate,
      LoanAmount: loanAmount,
      InterestRate: parseFloat(loanData.InterestRate) || 0,
      InterestType: loanData.InterestType || "Simple",
      LoanPeriod: loanData.LoanPeriod || "",
      ProcessingFee: parseFloat(loanData.ProcessingFee) || 0,
      DocumentCharge: parseFloat(loanData.DocumentCharge) || 0,
      InsuranceCharge: parseFloat(loanData.InsuranceCharge) || 0,
      TotalCharges: parseFloat(loanData.TotalCharges) || 0,
      NetDisbursementAmount: parseFloat(loanData.NetDisbursementAmount) || 0,
      DueDate: loanData.DueDate,
      LoanStatus: "Active",
      Remarks: loanData.Remarks || "",
      CreatedDate: new Date().toISOString()
    };
    appendRow("Loans", record);

    // Link ornaments and update their status
    (loanData.ornamentIds || []).forEach(ornamentId => {
      const mappingId = generateId("MAP", "LoanOrnaments", "MappingId");
      appendRow("LoanOrnaments", { MappingId: mappingId, LoanId: loanId, OrnamentId: ornamentId, Status: "Pledged" });
      updateRow("Ornaments", "OrnamentId", ornamentId, { Status: "Pledged" });
    });

    // Recalculate & sync utilized amount for this user + bank
    recalculateAndSyncBankUtilization(loanData.BankAccountId);

    return { success: true, data: record };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function getLoans(userId, status) {
  try {
    let loans = getSheetData("Loans");
    if (userId) loans = loans.filter(l => String(l.UserId) === String(userId));
    if (status) loans = loans.filter(l => l.LoanStatus === status);

    const bankAccounts = getSheetData("BankAccounts");
    const bankMap = new Map(bankAccounts.map(b => [String(b.BankAccountId), b.BankName]));

    loans = loans.map(l => ({
      ...l,
      BankName: l.BankName || bankMap.get(String(l.BankAccountId)) || ""
    }));

    return { success: true, data: loans };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function updateLoanStatus(loanId, status) {
  try {
    const loan = getSheetData("Loans").find(l => String(l.LoanId) === String(loanId));
    updateRow("Loans", "LoanId", loanId, { LoanStatus: status, UpdatedDate: new Date().toISOString() });
    if (loan && loan.BankAccountId) {
      recalculateAndSyncBankUtilization(loan.BankAccountId);
    }
    return { success: true, data: "Loan status updated" };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function updateLoan(loanId, loanData) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const loans = getSheetData("Loans");
    const existingLoan = loans.find(l => String(l.LoanId) === String(loanId));
    if (!existingLoan) return { success: false, error: "Loan not found" };

    // Check duplicate loan number if changed
    if (loanData.LoanNumber && String(loanData.LoanNumber) !== String(existingLoan.LoanNumber)) {
      const duplicate = loans.find(l =>
        String(l.LoanNumber) === String(loanData.LoanNumber) &&
        String(l.LoanId) !== String(loanId) &&
        l.LoanStatus !== "Cancelled"
      );
      if (duplicate) return { success: false, error: "Loan number already exists" };
    }

    const oldBankAccountId = existingLoan.BankAccountId;
    const newBankAccountId = loanData.BankAccountId || oldBankAccountId;
    const oldLoanAmount = parseFloat(existingLoan.LoanAmount) || 0;
    const newLoanAmount = parseFloat(loanData.LoanAmount) || 0;
    const isLoanActive = existingLoan.LoanStatus === "Active";

    const bankAccounts = getSheetData("BankAccounts");
    const newAcc = bankAccounts.find(a => String(a.BankAccountId) === String(newBankAccountId));
    const bankName = newAcc ? newAcc.BankName : (loanData.BankName || existingLoan.BankName || "");

    const targetUserId = loanData.UserId || existingLoan.UserId;
    if (isLoanActive && newAcc) {
      const maxLoan = parseFloat(newAcc.MaxLoanAmount) || 0;
      if (maxLoan > 0) {
        const activeLoans = getSheetData("Loans").filter(l => l.LoanStatus === "Active");
        const otherUtilized = activeLoans
          .filter(l => String(l.LoanId) !== String(loanId) &&
                       String(l.UserId) === String(targetUserId) &&
                       String(l.BankAccountId) === String(newBankAccountId))
          .reduce((sum, l) => sum + (parseFloat(l.LoanAmount) || 0), 0);
        const available = Math.max(0, maxLoan - otherUtilized);
        if (newLoanAmount > available) {
          return {
            success: false,
            error: `Updated loan amount of ₹${newLoanAmount} exceeds available limit of ₹${available} for ${newAcc.BankName} (Account ${newAcc.AccountNumber}). Max Limit: ₹${maxLoan}, Already Utilized: ₹${otherUtilized}`
          };
        }
      }
    }

    // Update Ornaments and LoanOrnaments mappings if loan is Active
    if (isLoanActive && loanData.ornamentIds) {
      const allMappings = getSheetData("LoanOrnaments");
      const currentMappings = allMappings.filter(m => String(m.LoanId) === String(loanId) && m.Status === "Pledged");
      const currentOrnamentIds = currentMappings.map(m => String(m.OrnamentId));
      const newOrnamentIds = (loanData.ornamentIds || []).map(String);

      // Ornaments to unpledge
      const ornamentsToRemove = currentOrnamentIds.filter(id => !newOrnamentIds.includes(id));
      // Ornaments to newly pledge
      const ornamentsToAdd = newOrnamentIds.filter(id => !currentOrnamentIds.includes(id));

      if (ornamentsToRemove.length > 0) {
        const mappingSheet = ss.getSheetByName("LoanOrnaments");
        if (mappingSheet) {
          const mappingData = mappingSheet.getDataRange().getValues();
          const headers = SHEET_HEADERS["LoanOrnaments"];
          const loanIdCol = headers.indexOf("LoanId");
          const ornIdCol = headers.indexOf("OrnamentId");
          const statusCol = headers.indexOf("Status");

          for (let i = mappingData.length - 1; i >= 1; i--) {
            const rowLoanId = String(mappingData[i][loanIdCol]);
            const rowOrnId = String(mappingData[i][ornIdCol]);
            const rowStatus = String(mappingData[i][statusCol]);
            if (rowLoanId === String(loanId) && ornamentsToRemove.includes(rowOrnId) && rowStatus === "Pledged") {
              mappingSheet.deleteRow(i + 1);
            }
          }
        }

        ornamentsToRemove.forEach(ornId => {
          updateRow("Ornaments", "OrnamentId", ornId, {
            Status: "Available",
            ReleaseDate: "",
            ReleasedLoanId: ""
          });
        });
      }

      ornamentsToAdd.forEach(ornId => {
        const mappingId = generateId("MAP", "LoanOrnaments", "MappingId");
        appendRow("LoanOrnaments", { MappingId: mappingId, LoanId: loanId, OrnamentId: ornId, Status: "Pledged" });
        updateRow("Ornaments", "OrnamentId", ornId, { Status: "Pledged" });
      });
    }

    // Update Loan Record
    const updateRecord = {
      LoanNumber: loanData.LoanNumber || existingLoan.LoanNumber,
      UserId: loanData.UserId || existingLoan.UserId,
      BankAccountId: newBankAccountId,
      BankName: bankName,
      LoanDate: loanData.LoanDate || existingLoan.LoanDate,
      LoanAmount: newLoanAmount,
      InterestRate: parseFloat(loanData.InterestRate) || 0,
      InterestType: loanData.InterestType || "Simple",
      LoanPeriod: loanData.LoanPeriod || "",
      ProcessingFee: parseFloat(loanData.ProcessingFee) || 0,
      DocumentCharge: parseFloat(loanData.DocumentCharge) || 0,
      InsuranceCharge: parseFloat(loanData.InsuranceCharge) || 0,
      TotalCharges: parseFloat(loanData.TotalCharges) || 0,
      NetDisbursementAmount: parseFloat(loanData.NetDisbursementAmount) || 0,
      DueDate: loanData.DueDate || existingLoan.DueDate,
      Remarks: loanData.Remarks !== undefined ? loanData.Remarks : existingLoan.Remarks,
      UpdatedDate: new Date().toISOString()
    };

    updateRow("Loans", "LoanId", loanId, updateRecord);

    if (isLoanActive) {
      recalculateAndSyncBankUtilization(newBankAccountId);
      if (String(oldBankAccountId) !== String(newBankAccountId)) {
        recalculateAndSyncBankUtilization(oldBankAccountId);
      }
    }

    return { success: true, data: { ...existingLoan, ...updateRecord } };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function getLoanDetails(loanId) {
  try {
    const loan = getSheetData("Loans").find(l => String(l.LoanId) === String(loanId));
    if (!loan) return { success: false, error: "Loan not found" };

    const bankAccount = loan.BankAccountId ? getSheetData("BankAccounts").find(b => String(b.BankAccountId) === String(loan.BankAccountId)) : null;
    if (bankAccount && !loan.BankName) {
      loan.BankName = bankAccount.BankName;
    }

    const mappings = getSheetData("LoanOrnaments").filter(
      m => String(m.LoanId) === String(loanId)
    );
    const allOrnaments = getSheetData("Ornaments");
    const ornaments = mappings.map(m => {
      const orn = allOrnaments.find(o => String(o.OrnamentId) === String(m.OrnamentId));
      return { ...m, ...orn };
    });

    const payments = getSheetData("Payments").filter(p => String(p.LoanId) === String(loanId));
    const releases = getSheetData("Releases").filter(r => String(r.LoanId) === String(loanId));

    return { success: true, data: { loan, bankAccount, ornaments, payments, releases } };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function closeAndReleaseLoan(loanId, closureRemarks) {
  try {
    const loanToClose = getSheetData("Loans").find(l => l.LoanId === loanId);

    const currentDate = new Date().toISOString();
    updateRow("Loans", "LoanId", loanId, {
      LoanStatus: "Closed",
      UpdatedDate: currentDate,
      ClosedDate: currentDate,
      ClosureRemarks: closureRemarks
    });

    const mappings = getSheetData("LoanOrnaments").filter(
      m => String(m.LoanId) === String(loanId) && m.Status === "Pledged"
    );

    mappings.forEach(m => {
      // Update the mapping table
      updateRow("LoanOrnaments", "MappingId", m.MappingId, { Status: "Released" });

      // Update the ornament itself
      updateRow("Ornaments", "OrnamentId", m.OrnamentId, {
        Status: "Released",
        ReleaseDate: currentDate,
        ReleasedLoanId: loanId
      });
    });
    // Recalculate & sync utilized amount for the bank account
    if (loanToClose && loanToClose.BankAccountId) {
      recalculateAndSyncBankUtilization(loanToClose.BankAccountId);
    }
    return { success: true, data: "Loan closed and ornaments released successfully" };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function getActiveLoansForClosure() {
  try {
    const loans = getSheetData("Loans").filter(l => l.LoanStatus === 'Active');
    const users = getSheetData("Users");
    const ornaments = getSheetData("Ornaments");
    const mappings = getSheetData("LoanOrnaments");
    const bankAccounts = getSheetData("BankAccounts");

    const userMap = new Map(users.map(u => [u.UserId, u]));
    const ornamentMap = new Map(ornaments.map(o => [o.OrnamentId, o]));
    const bankMap = new Map(bankAccounts.map(b => [String(b.BankAccountId), b.BankName]));

    const results = loans.map(loan => {
      const user = userMap.get(loan.UserId) || {};
      const linkedMappings = mappings.filter(m => m.LoanId === loan.LoanId);
      const linkedOrnamentNames = linkedMappings
        .map(m => ornamentMap.get(m.OrnamentId))
        .filter(Boolean)
        .map(o => o.OrnamentName);

      return {
        ...loan,
        BankName: loan.BankName || bankMap.get(String(loan.BankAccountId)) || '—',
        customerName: user.FullName || 'N/A',
        mobileNumber: user.MobileNumber || 'N/A',
        linkedOrnaments: linkedOrnamentNames.join(', ')
      };
    });
    return { success: true, data: results };
  } catch (e) { return { success: false, error: e.message }; }
}

// ─── PAYMENT FUNCTIONS ───

function addPayment(paymentData) {
  try {
    const paymentId = generateId("PAY", "Payments", "PaymentId");
    const record = {
      PaymentId: paymentId,
      LoanId: paymentData.LoanId,
      PaymentDate: paymentData.PaymentDate,
      PaymentType: paymentData.PaymentType || "Partial",
      PrincipalAmount: parseFloat(paymentData.PrincipalAmount) || 0,
      InterestAmount: parseFloat(paymentData.InterestAmount) || 0,
      PenaltyAmount: parseFloat(paymentData.PenaltyAmount) || 0,
      TotalPaidAmount: parseFloat(paymentData.TotalPaidAmount) || 0,
      PaymentMethod: paymentData.PaymentMethod || "Cash",
      TransactionReference: paymentData.TransactionReference || "",
      Remarks: paymentData.Remarks || "",
      CreatedDate: new Date().toISOString()
    };
    appendRow("Payments", record);
    return { success: true, data: record };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ─── RELEASE FUNCTIONS ───

function releaseOrnaments(releaseData) {
  try {
    const proofUrl = processDriveFiles(releaseData.files, "Delivery_Proofs")[0] || "";

    (releaseData.ornamentIds || []).forEach(ornamentId => {
      const releaseId = generateId("REL", "Releases", "ReleaseId");
      const record = {
        ReleaseId: releaseId,
        LoanId: releaseData.LoanId,
        OrnamentId: ornamentId,
        ReleaseDate: releaseData.ReleaseDate,
        ReleasedBy: releaseData.ReleasedBy || "",
        CustomerSignature: "", // Placeholder for signature data if captured
        DeliveryProofImage: proofUrl,
        Remarks: releaseData.Remarks || ""
      };
      appendRow("Releases", record);

      // Update ornament status to Available
      updateRow("Ornaments", "OrnamentId", ornamentId, { Status: "Available" });

      // Update mapping status
      const mappings = getSheetData("LoanOrnaments");
      const mappingToUpdate = mappings.find(m => String(m.LoanId) === String(releaseData.LoanId) && String(m.OrnamentId) === String(ornamentId));
      if (mappingToUpdate) {
        updateRow("LoanOrnaments", "MappingId", mappingToUpdate.MappingId, { Status: "Released" });
      }
    });

    return { success: true, data: "Ornaments released successfully" };
  } catch (e) {
    return { success: false, error: e.message };
  }
}


// ─── DASHBOARD FUNCTIONS ───

function getDashboardData() {
  try {
    const users = getSheetData("Users").filter(u => u.Status === "Active");
    const bankAccounts = getSheetData("BankAccounts").filter(b => b.Status === "Active");
    const ornaments = getSheetData("Ornaments").filter(o => o.Status !== "Deleted");
    const pledgedOrnaments = ornaments.filter(o => o.Status === "Pledged");
    const pledgedOrnamentsCount = pledgedOrnaments.length;
    const pledgedGrams = pledgedOrnaments.reduce((sum, o) => sum + (parseFloat(o.GrossWeight) || 0), 0);
    const loans = getSheetData("Loans");
    const activeLoans = loans.filter(l => l.LoanStatus === "Active");
    const closedLoans = loans.filter(l => l.LoanStatus === "Closed");
    const totalLoanAmount = activeLoans.reduce((sum, l) => sum + (parseFloat(l.LoanAmount) || 0), 0);

    const payments = getSheetData("Payments");
    const recentTransactions = payments.slice(-5).reverse();

    return {
      success: true,
      data: {
        totalUsers: users.length,
        totalBankAccounts: bankAccounts.length,
        totalOrnaments: ornaments.length,
        pledgedOrnamentsCount,
        pledgedGrams,
        activeLoans: activeLoans.length,
        closedLoans: closedLoans.length,
        totalLoanAmount,
        recentTransactions
      }
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ─── LIVE GOLD RATE TRACKER (GOODRETURNS BANGALORE) ───

/**
 * Fetches and parses real-time gold rates for Bangalore from GoodReturns.in.
 * Features 30-minute caching via CacheService and persistent fallback via PropertiesService.
 *
 * @param {boolean} [forceRefresh=false] Whether to bypass CacheService
 * @returns {Object} JSON result with rates for 24K, 22K, 18K gold per gram and daily changes
 */
function getGoldRates(forceRefresh) {
  try {
    const cache = CacheService.getScriptCache();
    const CACHE_KEY = "GOLD_RATES_BANGALORE_V1";
    const PROP_KEY = "LAST_KNOWN_GOLD_RATES_BANGALORE";

    // 1. Check script cache (if not forcing refresh)
    if (!forceRefresh) {
      const cached = cache.get(CACHE_KEY);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (parsed && parsed.data && parsed.data.gold24k) {
            return { ...parsed, isCached: true };
          }
        } catch (e) {
          // Cache corruption fallback
        }
      }
    }

    // 2. Fetch live webpage HTML
    const url = "https://www.goodreturns.in/gold-rates/bangalore.html";
    const options = {
      method: "get",
      muteHttpExceptions: true,
      validateHttpsCertificates: true,
      followRedirects: true,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache"
      }
    };

    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();

    if (statusCode !== 200) {
      throw new Error(`External source returned HTTP ${statusCode}`);
    }

    const html = response.getContentText();
    const ratesData = parseGoldRatesHtml(html);

    if (!ratesData || !ratesData.gold24k || !ratesData.gold22k || !ratesData.gold18k) {
      throw new Error("Unable to extract complete gold rate data from page content.");
    }

    const result = {
      success: true,
      data: ratesData
    };

    // 3. Save to CacheService (30 min = 1800s)
    try {
      cache.put(CACHE_KEY, JSON.stringify(result), 1800);
    } catch (cacheErr) {
      console.warn("CacheService write error:", cacheErr);
    }

    // 4. Save to persistent PropertiesService as emergency backup
    try {
      PropertiesService.getScriptProperties().setProperty(PROP_KEY, JSON.stringify(ratesData));
    } catch (propErr) {
      console.warn("PropertiesService write error:", propErr);
    }

    return result;

  } catch (error) {
    console.error("getGoldRates error:", error);

    // Fallback: Check persistent storage if live scrape fails
    try {
      const fallbackProp = PropertiesService.getScriptProperties().getProperty("LAST_KNOWN_GOLD_RATES_BANGALORE");
      if (fallbackProp) {
        const fallbackData = JSON.parse(fallbackProp);
        return {
          success: true,
          data: fallbackData,
          isFallback: true,
          warning: "Displaying recently cached rates (Live server unreachable: " + error.message + ")"
        };
      }
    } catch (propErr) {
      // Ignore fallback read error
    }

    return {
      success: false,
      error: error.message || "Failed to retrieve Bangalore gold rates."
    };
  }
}

/**
 * Robust, multi-strategy HTML parser for GoodReturns gold rates.
 * Parses 1-gram rates and daily changes for 24K, 22K, and 18K gold.
 *
 * @param {string} html Raw webpage HTML
 * @returns {Object|null} Extracted rates object
 */
function parseGoldRatesHtml(html) {
  try {
    if (!html || typeof html !== "string") {
      return null;
    }

    // Decode standard HTML entities & normalize whitespace
    const cleanHtml = html
      .replace(/&#x20b9;/gi, "₹")
      .replace(/&#8377;/gi, "₹")
      .replace(/&nbsp;/gi, " ")
      .replace(/&#160;/gi, " ");

    const rates = {
      location: "Bangalore",
      updatedAt: new Date().toISOString(),
      displayDate: "",
      gold24k: null,
      gold22k: null,
      gold18k: null
    };

    // Extract formatted date from page
    const dateMatch = cleanHtml.match(/id=["']metal-price-date["'][^>]*>([\s\S]*?)<\/span>/i) ||
                      cleanHtml.match(/<title[^>]*>[\s\S]*?(?:on|for)\s+([0-9]{1,2}\s+[A-Za-z]+\s+[0-9]{4})/i);
    if (dateMatch) {
      rates.displayDate = dateMatch[1].replace(/<[^>]+>/g, "").trim();
    } else {
      const now = new Date();
      rates.displayDate = Utilities.formatDate(now, "Asia/Kolkata", "dd MMMM yyyy");
    }

    function parseCell(cellHtml) {
      if (!cellHtml) return null;

      let deltaHtml = "";
      const spanMatch = cellHtml.match(/<span[^>]*class=["'][^"']*gr-(?:change|delta)[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) ||
                        cellHtml.match(/<span[^>]*>([\s\S]*?)<\/span>/i);
      if (spanMatch) {
        deltaHtml = spanMatch[0];
      }

      // Remove karat badges / labels to avoid false price matches
      const withoutSpan = cellHtml
        .replace(/<span[^>]*>[\s\S]*?<\/span>/gi, "")
        .replace(/\b(?:24|22|18)\s*K(?:arat)?\b/gi, "");

      const priceText = withoutSpan.replace(/<[^>]+>/g, " ").trim();
      const priceMatch = priceText.match(/(?:₹|Rs\.?|INR)?\s*([0-9]{1,3}(?:,[0-9]{2,3})*(?:\.[0-9]+)?|[0-9]{4,})/i);

      let price = "—";
      let numericPrice = 0;
      if (priceMatch) {
        const rawDigits = priceMatch[1].trim();
        price = "₹" + rawDigits;
        numericPrice = parseFloat(rawDigits.replace(/,/g, "")) || 0;
      }

      let change = 0;
      let changeStr = "0";
      let direction = "neutral";
      let formattedBadge = "0 —";

      const deltaText = deltaHtml.replace(/<[^>]+>/g, " ").trim();
      const changeMatch = deltaText.match(/([+-]?)\s*([0-9,]+(?:\.[0-9]+)?)/) ||
                          cellHtml.match(/\(([+-]?)\s*([0-9,]+(?:\.[0-9]+)?)\)/);

      const hasDown = /gr-(?:change|delta)-down|red-span/i.test(deltaHtml || cellHtml) || deltaText.includes("-");
      const hasUp = /gr-(?:change|delta)-up|green-span/i.test(deltaHtml || cellHtml) || deltaText.includes("+");

      if (changeMatch) {
        const sign = changeMatch[1];
        const valStr = changeMatch[2];
        const numVal = parseFloat(valStr.replace(/,/g, "")) || 0;

        if (sign === "-" || hasDown) {
          direction = "down";
          change = -numVal;
          changeStr = `-${valStr}`;
          formattedBadge = `- ${valStr} ▼`;
        } else if (sign === "+" || hasUp || numVal > 0) {
          direction = "up";
          change = numVal;
          changeStr = `+${valStr}`;
          formattedBadge = `+ ${valStr} ▲`;
        } else {
          direction = "neutral";
          change = 0;
          changeStr = "0";
          formattedBadge = "0 —";
        }
      }

      return {
        price,
        numericPrice,
        change,
        changeStr,
        direction,
        formattedBadge
      };
    }

    // ── Strategy 1: HTML Table parsing (Gram | 24K | 22K | 18K) ──
    const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
    let tMatch;
    while ((tMatch = tableRegex.exec(cleanHtml)) !== null) {
      const tableContent = tMatch[1];
      if (/24\s*K/i.test(tableContent) && /22\s*K/i.test(tableContent) && /18\s*K/i.test(tableContent)) {
        const ths = [...tableContent.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map(h => h[1].replace(/<[^>]+>/g, "").trim());
        let col24 = ths.findIndex(h => /24\s*K/i.test(h));
        let col22 = ths.findIndex(h => /22\s*K/i.test(h));
        let col18 = ths.findIndex(h => /18\s*K/i.test(h));

        if (col24 === -1) col24 = 1;
        if (col22 === -1) col22 = 2;
        if (col18 === -1) col18 = 3;

        const rows = [...tableContent.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(r => r[1]);
        for (const row of rows) {
          const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(d => d[1]);
          if (tds.length >= 4) {
            const col0 = tds[0].replace(/<[^>]+>/g, "").trim();
            if (/^1(\s*g(ram)?)?$/i.test(col0) || col0 === "1") {
              rates.gold24k = parseCell(tds[col24]);
              rates.gold22k = parseCell(tds[col22]);
              rates.gold18k = parseCell(tds[col18]);
              break;
            }
          }
        }
        if (rates.gold24k && rates.gold22k && rates.gold18k) break;
      }
    }

    // ── Strategy 2: ID-based markup (id="24K-price", id="22K-price", id="18K-price") ──
    if (!rates.gold24k || !rates.gold22k || !rates.gold18k) {
      const karats = [
        { key: "gold24k", id: "24K-price" },
        { key: "gold22k", id: "22K-price" },
        { key: "gold18k", id: "18K-price" }
      ];

      karats.forEach(k => {
        if (!rates[k.key]) {
          const m = cleanHtml.match(new RegExp(`id=["']${k.id}["'][^>]*>([\\s\\S]*?)<\\/span>`, "i"));
          if (m) {
            const rawVal = m[1].replace(/<[^>]+>/g, "").trim();
            const pos = cleanHtml.indexOf(m[0]);
            const nearby = cleanHtml.substring(pos, pos + 300);
            const valObj = parseCell(rawVal);
            const nearbyObj = parseCell(nearby);

            rates[k.key] = {
              price: (valObj && valObj.numericPrice > 500) ? valObj.price : (nearbyObj ? nearbyObj.price : "—"),
              numericPrice: (valObj && valObj.numericPrice > 500) ? valObj.numericPrice : (nearbyObj ? nearbyObj.numericPrice : 0),
              change: nearbyObj ? nearbyObj.change : 0,
              changeStr: nearbyObj ? nearbyObj.changeStr : "0",
              direction: nearbyObj ? nearbyObj.direction : "neutral",
              formattedBadge: nearbyObj ? nearbyObj.formattedBadge : "0 —"
            };
          }
        }
      });
    }

    return rates;
  } catch (err) {
    console.error("parseGoldRatesHtml error:", err);
    return null;
  }
}

/**
 * One-Click Authorization & Test Function
 * Run this function once from the Apps Script IDE toolbar to grant the
 * 'https://www.googleapis.com/auth/script.external_request' permission.
 */
function testGoldRates() {
  console.log("Testing getGoldRates()...");
  const result = getGoldRates(true);
  console.log("Result:", JSON.stringify(result, null, 2));
  return result;
}
