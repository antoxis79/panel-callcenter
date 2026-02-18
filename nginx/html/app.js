fetch("/api/vendedor")
.then(res => res.json())
.then(data => {

    const tbody = document.querySelector("#tabla tbody");

    data.rows.forEach(v => {

        const tr = document.createElement("tr");

        tr.innerHTML = `
        <td>${v.id}</td>
        <td>${v.agente}</td>
        <td>${v.anexo}</td>
        <td>${v.fecha_de_ingreso}</td>
        <td>${v.cantidad_ventas}</td>
        `;

        tbody.appendChild(tr);
    });

});
