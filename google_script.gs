/**
 * BACKEND PARA ATELIER MARIAS - VERSÃO 02 (PLANILHA Ver02)
 * Instruções:
 * 1. Abra sua Planilha Google.
 * 2. Vá em Extensões > Apps Script.
 * 3. Delete todo o código atual e cole este novo.
 * 4. Clique em 'Salvar' (ícone de disquete).
 * 5. Clique em 'Implantar' > 'Gerenciar Implantações'.
 * 6. Clique no lápis (editar) e em 'Versão' escolha 'Nova Versão'.
 * 7. Clique em 'Implantar'.
 */
function doPost(e) {
  var data = JSON.parse(e.postData.contents);
  var action = data.action;
  var payload = data.payload;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  try {
    if (action === 'sync_product') {
      return syncProduct(ss, payload);
    } else if (action === 'sync_sale') {
      return syncSale(ss, payload);
    } else if (action === 'sync_category') {
      return syncCategory(ss, payload);
    } else if (action === 'delete_product') {
      return deleteRow(ss, 'Produtos', 'CÓDIGO DO PRODUTO', payload);
    } else if (action === 'delete_category') {
      return deleteRow(ss, 'Categorias', 'CATEGORIA', payload);
    } else if (action === 'get_all_data') {
      return getAllData(ss);
    }
    
    return ContentService.createTextOutput(JSON.stringify({ success: true })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.message })).setMimeType(ContentService.MimeType.JSON);
  }
}

function syncProduct(ss, product) {
  var sheet = getOrCreateSheet(ss, 'Produtos');
  var headers = ['CÓDIGO DO PRODUTO', 'DESCRIÇÃO DO PRODUTO', 'TAMANHO_L', 'TAMANHO_N', 'VALOR', 'ESTOQUE', 'CATEGORIA', 'LOCAL DA FOTO'];
  ensureHeaders(sheet, headers);
  
  var imageUrl = product.image || '';
  
  if (product.imageBase64) {
    var driveRes = saveImageToDrive(product.id, product.imageBase64);
    if (driveRes && driveRes.indexOf('G_SCRIPT_ERROR') === -1) {
        imageUrl = driveRes;
    } else if (driveRes) {
        imageUrl = driveRes; // Write the error in the spreadsheet so we can read it!
    }
  }
  
  var rowData = [
    product.id,
    product.name,
    product.size_letter || '',
    product.size_number ? "'" + product.size_number : '',
    product.price,
    product.stock,
    product.category || 'Geral',
    imageUrl
  ];
  
  upsertRow(sheet, 'CÓDIGO DO PRODUTO', product.id, rowData);

  // --- Salvar Histórico de Estoque ---
  if (product.history && product.history.length > 0) {
    var sheetHist = getOrCreateSheet(ss, 'Historico_Produtos');
    ensureHeaders(sheetHist, ['CÓDIGO DO PRODUTO', 'DATA', 'TIPO', 'QUANTIDADE']);
    
    // Limpar histórico anterior deste produto para re-inserir o novo estado (seguindo o padrão do app)
    deleteRowsByValue(sheetHist, 'CÓDIGO DO PRODUTO', product.id);
    
    product.history.forEach(function(h) {
      sheetHist.appendRow([
        product.id,
        h.date,
        h.type,
        h.quantity
      ]);
    });
  }

  return ContentService.createTextOutput(JSON.stringify({ success: true, imageUrl: imageUrl })).setMimeType(ContentService.MimeType.JSON);
}

function saveImageToDrive(filename, base64Data) {
  try {
    var folderName = "Atelier_Mobile_Images_Ver02";
    var folders = DriveApp.getFoldersByName(folderName);
    var folder;
    if (folders.hasNext()) {
      folder = folders.next();
    } else {
      folder = DriveApp.createFolder(folderName);
      folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    }
    
    var data = base64Data;
    if (base64Data.indexOf('base64,') !== -1) {
      data = base64Data.split('base64,')[1];
    }
    
    var blob = Utilities.newBlob(Utilities.base64Decode(data), 'image/jpeg', filename + '.jpg');
    
    var files = folder.getFilesByName(filename + '.jpg');
    if (files.hasNext()) {
      var file = files.next();
      file.setTrashed(true);
    }
    var newFile = folder.createFile(blob);
    
    return "https://drive.google.com/uc?export=view&id=" + newFile.getId();
  } catch (e) {
    return "G_SCRIPT_ERROR: " + e.message;
  }
}


function syncSale(ss, sale) {
  // 1. Aba Vendas
  var sheetVendas = getOrCreateSheet(ss, 'Vendas');
  var headersVendas = ['CÓDIGO DA VENDA', 'CLIENTE', 'DATA COMPRA', 'FORMA DE PAGAMENTO', 'VALOR DA COMPRA', 'DATA SINCRONISMO'];
  ensureHeaders(sheetVendas, headersVendas);
  
  var rowVenda = [
    sale.id,
    sale.client,
    sale.date,
    sale.paymentType,
    sale.totalValue,
    new Date()
  ];
  upsertRow(sheetVendas, 'CÓDIGO DA VENDA', sale.id, rowVenda);
  
  // 2. Aba Itens_Venda
  var sheetItens = getOrCreateSheet(ss, 'Itens_Venda');
  var headersItens = ['CÓDIGO DA VENDA', 'CÓDIGO DO PRODUTO', 'DESCRIÇÃO DO PRODUTO', 'VALOR UNITÁRIO', 'QUANTIDADE', 'VALOR TOTAL'];
  ensureHeaders(sheetItens, headersItens);
  
  // Limpar itens anteriores desta venda para evitar duplicidade em edição
  deleteRowsByValue(sheetItens, 'CÓDIGO DA VENDA', sale.id);
  
  if (sale.products && sale.products.length > 0) {
    sale.products.forEach(function(p) {
      var rowItem = [
        sale.id,
        p.id, // O app já envia o inventoryId/id correto
        p.name,
        parseFloat(p.price),
        parseInt(p.quantity),
        parseFloat(p.price) * parseInt(p.quantity)
      ];
      sheetItens.appendRow(rowItem);
    });
  }
  
  // 3. Aba Parcelas_Venda
  var sheetParcelas = getOrCreateSheet(ss, 'Parcelas_Venda');
  var headersParcelas = ['CÓDIGO DA VENDA', 'PARCELA', 'DATA', 'VALOR DA PARCELA', 'SITUAÇÃO', 'TRAVADA'];
  ensureHeaders(sheetParcelas, headersParcelas);
  
  deleteRowsByValue(sheetParcelas, 'CÓDIGO DA VENDA', sale.id);
  
  if (sale.installmentList && sale.installmentList.length > 0) {
    sale.installmentList.forEach(function(inst) {
      var rowParcela = [
        sale.id,
        inst.number,
        inst.date,
        inst.value,
        inst.status === 'paid' ? 'Pago' : 'Pendente',
        inst.isLocked ? 'Sim' : 'Não'
      ];
      sheetParcelas.appendRow(rowParcela);
    });
  }
  
  return ContentService.createTextOutput(JSON.stringify({ success: true })).setMimeType(ContentService.MimeType.JSON);
}

function syncCategory(ss, category) {
  var sheet = getOrCreateSheet(ss, 'Categorias');
  var headers = ['CATEGORIA', 'TIPO_TAMANHO'];
  ensureHeaders(sheet, headers);
  
  var tipoTamanho = "";
  if (category.size_type === 'letter') tipoTamanho = "Literal";
  else if (category.size_type === 'number') tipoTamanho = "Numeral";
  
  var rowData = [
    category.name,
    tipoTamanho
  ];
  
  upsertRow(sheet, 'CATEGORIA', category.name, rowData);
  return ContentService.createTextOutput(JSON.stringify({ success: true })).setMimeType(ContentService.MimeType.JSON);
}

// --- Funções Utilitárias ---

function getOrCreateSheet(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}

function ensureHeaders(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#d9ead3");
  }
}

function upsertRow(sheet, keyHeader, keyValue, rowData) {
  var data = sheet.getDataRange().getValues();
  var headerRow = data[0];
  var keyColIndex = headerRow.indexOf(keyHeader);
  
  if (keyColIndex === -1) return sheet.appendRow(rowData);
  
  for (var i = 1; i < data.length; i++) {
    if (data[i][keyColIndex].toString() === keyValue.toString()) {
      sheet.getRange(i + 1, 1, 1, rowData.length).setValues([rowData]);
      return;
    }
  }
  sheet.appendRow(rowData);
}

function deleteRow(ss, sheetName, keyHeader, keyValue) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return ContentService.createTextOutput(JSON.stringify({ success: true })).setMimeType(ContentService.MimeType.JSON);
  
  var data = sheet.getDataRange().getValues();
  var headerRow = data[0];
  var keyColIndex = headerRow.indexOf(keyHeader);
  
  if (keyColIndex === -1) return ContentService.createTextOutput(JSON.stringify({ success: true })).setMimeType(ContentService.MimeType.JSON);
  
  for (var i = data.length - 1; i >= 1; i--) {
    if (data[i][keyColIndex].toString() === keyValue.toString()) {
      sheet.deleteRow(i + 1);
    }
  }
  return ContentService.createTextOutput(JSON.stringify({ success: true })).setMimeType(ContentService.MimeType.JSON);
}

function deleteRowsByValue(sheet, keyHeader, keyValue) {
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return;
  
  var headerRow = data[0];
  var keyColIndex = headerRow.indexOf(keyHeader);
  if (keyColIndex === -1) return;
  
  for (var i = data.length - 1; i >= 1; i--) {
    if (data[i][keyColIndex].toString() === keyValue.toString()) {
      sheet.deleteRow(i + 1);
    }
  }
}

function formatDateString(val, ss) {
  if (!val) return '';
  if (Object.prototype.toString.call(val) === '[object Date]') {
    return Utilities.formatDate(val, ss.getSpreadsheetTimeZone() || "GMT", "yyyy-MM-dd");
  }
  var str = val.toString();
  if (str.indexOf('T') > -1) str = str.split('T')[0];
  return str;
}

function parseCurrency(val) {
  if (!val) return 0;
  var str = val.toString().trim();
  
  // Remove all non-numeric characters EXCEPT comma, dot, and minus sign
  // This gracefully handles "r$ ", "RS ", "R $", alphabetical typos, etc.
  str = str.replace(/[^\d.,-]/g, '').trim();
  
  if (str.indexOf(',') !== -1) {
      // Tem virgula (formato BR) - tiramos os possiveis pontos de milhar e trocamos a virgula por ponto
      str = str.replace(/\./g, '').replace(/,/g, '.');
  } else {
      // Se nao tem virgula, ja deve estar em formato JS standard (ex: 45.00). Nao removemos os pontos!
  }
  
  var num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

function getAllData(ss) {
  var result = {
    success: true,
    categories: [],
    products: [],
    sales: [],
    sale_items: [],
    installments: [],
    product_history: []
  };

  // Categorias
  var sheetCat = ss.getSheetByName('Categorias');
  if (sheetCat) {
    var dataCat = sheetCat.getDataRange().getValues();
    if (dataCat.length > 1) {
      var headers = dataCat[0].map(function(h) { return h ? h.toString().trim().toUpperCase() : ''; });
      var idxName = headers.indexOf('CATEGORIA');
      var idxType = headers.indexOf('TIPO_TAMANHO');

      for (var i = 1; i < dataCat.length; i++) {
        var row = dataCat[i];
        if (idxName !== -1 && row[idxName]) {
          var sType = 'none';
          if (idxType !== -1 && row[idxType]) {
            var val = row[idxType].toString();
            if (val === 'Literal') sType = 'letter';
            else if (val === 'Numeral') sType = 'number';
          }
          result.categories.push({
            id: i, // Use row index as ID if not present
            name: row[idxName].toString(),
            size_type: sType
          });
        }
      }
    }
  }

  // Produtos
  var sheetProd = ss.getSheetByName('Produtos');
  if (sheetProd) {
    var dataProd = sheetProd.getDataRange().getValues();
    if (dataProd.length > 1) {
      var headers = dataProd[0].map(function(h) { return h ? h.toString().trim().toUpperCase() : ''; });
      var idxId = headers.indexOf('CÓDIGO DO PRODUTO');
      var idxName = headers.indexOf('DESCRIÇÃO DO PRODUTO');
      var idxPrice = headers.indexOf('VALOR');
      var idxStock = headers.indexOf('ESTOQUE');
      var idxCategory = headers.indexOf('CATEGORIA');
      var idxSizeN = headers.indexOf('TAMANHO_N');
      var idxSizeL = headers.indexOf('TAMANHO_L');
      var idxImage = headers.indexOf('LOCAL DA FOTO');

      for (var i = 1; i < dataProd.length; i++) {
        var row = dataProd[i];
        if (idxId !== -1 && row[idxId]) {
          result.products.push({
            id: row[idxId].toString(),
            name: (idxName !== -1 && row[idxName]) ? row[idxName].toString() : '',
            price: (idxPrice !== -1 && row[idxPrice]) ? parseCurrency(row[idxPrice]).toString() : '0',
            stock: (idxStock !== -1 && row[idxStock]) ? parseInt(row[idxStock]) || 0 : 0,
            category: (idxCategory !== -1 && row[idxCategory]) ? row[idxCategory].toString() : 'Geral',
            size_number: (idxSizeN !== -1 && row[idxSizeN]) ? parseInt(row[idxSizeN]) : null,
            size_letter: (idxSizeL !== -1 && row[idxSizeL]) ? row[idxSizeL].toString() : null,
            image: (idxImage !== -1 && row[idxImage]) ? row[idxImage].toString() : null,
            history: [] 
          });
        }
      }
    }
  }

  // Vendas
  var sheetVendas = ss.getSheetByName('Vendas');
  if (sheetVendas) {
    var dataVendas = sheetVendas.getDataRange().getValues();
    if (dataVendas.length > 1) {
      var headers = dataVendas[0].map(function(h) { return h ? h.toString().trim().toUpperCase() : ''; });
      var idxId = headers.indexOf('CÓDIGO DA VENDA');
      var idxClient = headers.indexOf('CLIENTE');
      var idxDate = headers.indexOf('DATA COMPRA');
      var idxPayment = headers.indexOf('FORMA DE PAGAMENTO');
      var idxTotal = headers.indexOf('VALOR DA COMPRA');
      if (idxTotal === -1) idxTotal = headers.indexOf('VALOR DA VENDA');
      if (idxTotal === -1) idxTotal = headers.indexOf('VALOR');

      for (var i = 1; i < dataVendas.length; i++) {
        var row = dataVendas[i];
        if (idxId !== -1 && row[idxId]) {
          result.sales.push({
            id: row[idxId].toString(),
            client: (idxClient !== -1 && row[idxClient]) ? row[idxClient].toString() : '',
            date: (idxDate !== -1) ? formatDateString(row[idxDate], ss) : '',
            paymentType: (idxPayment !== -1 && row[idxPayment]) ? row[idxPayment].toString() : 'vista',
            installments: '', // Será ajustado no app baseado nas parcelas
            totalValue: (idxTotal !== -1 && row[idxTotal]) ? parseCurrency(row[idxTotal]) : 0
          });
        }
      }
    }
  }

  // Itens Venda
  var sheetItens = ss.getSheetByName('Itens_Venda');
  if (sheetItens) {
    var dataItens = sheetItens.getDataRange().getValues();
    if (dataItens.length > 1) {
      var headers = dataItens[0].map(function(h) { return h ? h.toString().trim().toUpperCase() : ''; });
      var idxSaleId = headers.indexOf('CÓDIGO DA VENDA');
      var idxProdId = headers.indexOf('CÓDIGO DO PRODUTO');
      var idxName = headers.indexOf('DESCRIÇÃO DO PRODUTO');
      var idxPrice = headers.indexOf('VALOR UNITÁRIO');
      var idxQty = headers.indexOf('QUANTIDADE');

      for (var i = 1; i < dataItens.length; i++) {
        var row = dataItens[i];
        if (idxSaleId !== -1 && row[idxSaleId]) {
          result.sale_items.push({
            sale_id: row[idxSaleId].toString(),
            id: (idxProdId !== -1 && row[idxProdId]) ? row[idxProdId].toString() : '',
            name: (idxName !== -1 && row[idxName]) ? row[idxName].toString() : '',
            price: (idxPrice !== -1 && row[idxPrice]) ? parseCurrency(row[idxPrice]).toString() : '0',
            quantity: (idxQty !== -1 && row[idxQty]) ? row[idxQty].toString() : '1',
            inventoryId: (idxProdId !== -1 && row[idxProdId]) ? row[idxProdId].toString() : null
          });
        }
      }
    }
  }

  // Parcelas Venda
  var sheetParcelas = ss.getSheetByName('Parcelas_Venda');
  if (sheetParcelas) {
    var dataParcelas = sheetParcelas.getDataRange().getValues();
    if (dataParcelas.length > 1) {
      var headers = dataParcelas[0].map(function(h) { return h ? h.toString().trim().toUpperCase() : ''; });
      var idxSaleId = headers.indexOf('CÓDIGO DA VENDA');
      var idxNum = headers.indexOf('PARCELA');
      var idxDate = headers.indexOf('DATA');
      var idxValue = headers.indexOf('VALOR DA PARCELA');
      if (idxValue === -1) idxValue = headers.indexOf('VALOR PARCELA');
      if (idxValue === -1) idxValue = headers.indexOf('VALOR');
      var idxStatus = headers.indexOf('SITUAÇÃO');
      var idxLocked = headers.indexOf('TRAVADA');

      for (var i = 1; i < dataParcelas.length; i++) {
        var row = dataParcelas[i];
        if (idxSaleId !== -1 && row[idxSaleId]) {
          result.installments.push({
            sale_id: row[idxSaleId].toString(),
            number: (idxNum !== -1 && row[idxNum]) ? parseInt(row[idxNum]) || 1 : 1,
            date: (idxDate !== -1) ? formatDateString(row[idxDate], ss) : '',
            value: (idxValue !== -1 && row[idxValue]) ? parseCurrency(row[idxValue]) : 0,
            status: (idxStatus !== -1 && row[idxStatus] && row[idxStatus].toString() === 'Pago') ? 'paid' : 'pending',
            isLocked: (idxLocked !== -1 && row[idxLocked] && row[idxLocked].toString() === 'Sim')
          });
        }
      }
    }
  }

  // Histórico de Produtos
  var sheetHist = ss.getSheetByName('Historico_Produtos');
  if (sheetHist) {
    var dataHist = sheetHist.getDataRange().getValues();
    if (dataHist.length > 1) {
      var headers = dataHist[0].map(function(h) { return h ? h.toString().trim().toUpperCase() : ''; });
      var idxProdId = headers.indexOf('CÓDIGO DO PRODUTO');
      var idxDate = headers.indexOf('DATA');
      var idxType = headers.indexOf('TIPO');
      var idxQty = headers.indexOf('QUANTIDADE');

      for (var i = 1; i < dataHist.length; i++) {
        var row = dataHist[i];
        if (idxProdId !== -1 && row[idxProdId]) {
          result.product_history.push({
            product_id: row[idxProdId].toString(),
            date: (idxDate !== -1) ? row[idxDate].toString() : '',
            type: (idxType !== -1) ? row[idxType].toString() : 'input',
            quantity: (idxQty !== -1) ? parseInt(row[idxQty]) || 0 : 0
          });
        }
      }
    }
  }

  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}
