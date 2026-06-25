const SPREADSHEET_ID =
  SpreadsheetApp.getActiveSpreadsheet().getId();
const SHEET_HEADERS = {
  Admins: ["AdminId", "Username", "Password", "Role", "Status"], // NEW: Admin Sheet
  Users: ["UserId", "CustomerCode", "FullName", "FatherHusbandName", "MobileNumber", "AlternateMobileNumber", "Email", "DateOfBirth", "Gender", "AadhaarNumber", "PANNumber", "AddressLine1", "AddressLine2", "City", "State", "Pincode", "Occupation", "CustomerPhoto", "Status", "CreatedDate", "UpdatedDate"],
  BankAccounts: ["BankAccountId", "UserId", "AccountHolderName", "AccountNumber", "BankName", "BranchName", "IFSCCode", "AccountType", "UPI_ID", "PassbookImage", "Status", "CreatedDate", "UpdatedDate", "MaxLoanAmount", "UtilizedLoanAmount"],
  Ornaments: ["OrnamentId", "UserId", "OrnamentName", "OrnamentType", "OrnamentCategory", "Description", "GrossWeight", "NetWeight", "StoneWeight", "Purity", "HallmarkNumber", "Quantity", "EstimatedValue", "MarketValue", "OrnamentImages", "Remarks", "Status", "ReleaseDate", "ReleasedLoanId"],
  Loans: ["LoanId", "LoanNumber", "UserId", "BankAccountId", "LoanDate", "LoanAmount", "InterestRate", "InterestType", "LoanPeriod", "ProcessingFee", "DocumentCharge", "InsuranceCharge", "TotalCharges", "NetDisbursementAmount", "DueDate", "LoanStatus", "Remarks", "CreatedDate", "UpdatedDate", "ClosedDate", "ClosureRemarks"],
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

      const firstRowRange = sheet.getRange(1, 1, 1, headers.length);
      const firstRow = firstRowRange.getValues()[0];
      const headersMatch = firstRow.every((val, i) => val === headers[i]);

      if (!headersMatch) {
        firstRowRange.setValues([headers]);
        firstRowRange.setFontWeight("bold").setBackground("#4a90e2").setFontColor("#ffffff");
        sheet.setFrozenRows(1);

        // NEW: Seed default admin credentials if setting up for the first time
        if (name === "Admins") {
          // Default Username: admin, Password: password123
          sheet.appendRow(["ADM001", "admin", "password123", "SuperAdmin", "Active"]);
        }
      }
    });
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
  const headers = SHEET_HEADERS[sheetName];
  const row = headers.map(h => rowObject[h] !== undefined ? rowObject[h] : "");
  sheet.appendRow(row);
}

function updateRow(sheetName, idColumn, idValue, updatedObject) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(sheetName);
  const headers = SHEET_HEADERS[sheetName];
  const idColIndex = headers.indexOf(idColumn);
  const data = sheet.getDataRange().getValues();
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

function getBankAccounts(userId) {
  try {
    let accounts = getSheetData("BankAccounts").filter(acc => acc.Status !== "Deleted");
    if (userId) {
      accounts = accounts.filter(acc => String(acc.UserId) === String(userId));
    }
    return { success: true, data: accounts };
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

    const loanId = generateId("L", "Loans", "LoanId");
    const record = {
      LoanId: loanId,
      LoanNumber: loanData.LoanNumber,
      UserId: loanData.UserId || "",
      BankAccountId: loanData.BankAccountId || "",
      LoanDate: loanData.LoanDate,
      LoanAmount: parseFloat(loanData.LoanAmount) || 0,
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

    // Update bank account's utilized amount
    const bankAccounts = getSheetData("BankAccounts");
    const bankAccount = bankAccounts.find(acc => acc.BankAccountId === loanData.BankAccountId);
    if (bankAccount) {
      const newUtilizedAmount = (parseFloat(bankAccount.UtilizedLoanAmount) || 0) + (parseFloat(loanData.LoanAmount) || 0);
      updateRow("BankAccounts", "BankAccountId", loanData.BankAccountId, { UtilizedLoanAmount: newUtilizedAmount });
    }

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
    return { success: true, data: loans };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function updateLoanStatus(loanId, status) {
  try {
    updateRow("Loans", "LoanId", loanId, { LoanStatus: status, UpdatedDate: new Date().toISOString() });
    return { success: true, data: "Loan status updated" };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function getLoanDetails(loanId) {
  try {
    const loan = getSheetData("Loans").find(l => String(l.LoanId) === String(loanId));
    if (!loan) return { success: false, error: "Loan not found" };

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

    return { success: true, data: { loan, ornaments, payments, releases } };
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
    // Reduce utilized loan amount in bank account
    if (loanToClose && loanToClose.BankAccountId) {
      const bankAccount = getSheetData("BankAccounts")
        .find(acc => acc.BankAccountId === loanToClose.BankAccountId);

      if (bankAccount) {
        const currentUtilized =
          parseFloat(bankAccount.UtilizedLoanAmount) || 0;

        const loanAmount =
          parseFloat(loanToClose.LoanAmount) || 0;

        const newUtilized =
          Math.max(0, currentUtilized - loanAmount);

        updateRow(
          "BankAccounts",
          "BankAccountId",
          loanToClose.BankAccountId,
          {
            UtilizedLoanAmount: newUtilized
          }
        );
      }
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

    const userMap = new Map(users.map(u => [u.UserId, u]));
    const ornamentMap = new Map(ornaments.map(o => [o.OrnamentId, o]));

    const results = loans.map(loan => {
      const user = userMap.get(loan.UserId) || {};
      const linkedMappings = mappings.filter(m => m.LoanId === loan.LoanId);
      const linkedOrnamentNames = linkedMappings
        .map(m => ornamentMap.get(m.OrnamentId))
        .filter(Boolean)
        .map(o => o.OrnamentName);

      return { ...loan, customerName: user.FullName || 'N/A', mobileNumber: user.MobileNumber || 'N/A', linkedOrnaments: linkedOrnamentNames.join(', ') };
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